// Runs Gavel on a repo as it looked on a past date, then scores its picks against what really happened.
// Usage: node eval/backtest.mjs --repo biomejs/biome --freeze 2026-07-13 [--runs 3] [--model claude-sonnet-5-5]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { snapshotAt, outcomesAfter, isMaintainer } from "../src/snapshot.mjs";
import { createModel } from "../src/model.mjs";
import { assessAll, ASSESS_VERSION } from "../src/assess.mjs";
import { shortlist, pick, RANK_VERSION } from "../src/rank.mjs";
import { proposeRules, RULES_VERSION } from "../src/rules.mjs";
import { focusAreas } from "../src/focus.mjs";
import { baselines } from "./baselines.mjs";
import { summarize } from "./score.mjs";

const DAY = 86400000;
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    freeze: { type: "string" },
    runs: { type: "string", default: "3" },
    window: { type: "string", default: "56" },
    "log-days": { type: "string", default: "90" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    "max-calls": { type: "string", default: "60" },
  },
});
const root = import.meta.dirname;
const slug = values.repo.replace("/", "__");
const freeze = values.freeze;
const D = new Date(freeze + "T00:00:00Z").getTime();
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

const raw = JSON.parse(await readFile(path.join(root, "data", slug, "raw.json"), "utf8"));
const vision = raw.readmes[freeze]?.text;
if (!vision) throw new Error(`no README stored for ${freeze}; re-run fetch with this freeze date`);

const snap = snapshotAt(raw, freeze + "T00:00:00Z");
const outcomes = outcomesAfter(raw, freeze + "T00:00:00Z", Number(values.window));
const model = createModel({ model: values.model, maxCalls: Number(values["max-calls"]), cwd: root });
const cache = (name) => path.join(root, "cache", "model", name);
log(`${snap.issues.length} issues open on ${freeze}`);

const assessments = await assessAll(snap.issues, {
  model, vision, cacheDir: cache("assess"),
  onProgress: (d, t) => log(`assessed ${d}/${t}`),
});
// What the maintainers fixed in the 60 days before the freeze: the "approvals" half of their history.
const recentFixes = [...(raw.past_completed || []), ...raw.issues]
  .filter((i) => i.state_reason === "completed" && i.closed_at && new Date(i.closed_at).getTime() <= D && new Date(i.closed_at).getTime() > D - 60 * DAY)
  .filter((i, k, all) => all.findIndex((x) => x.number === i.number) === k)
  .map((i) => ({ labels: i.labels_now || [] }));
const areas = focusAreas(recentFixes);
const shorts = {
  without_history: shortlist(snap.issues, assessments, freeze + "T00:00:00Z"),
  with_history: shortlist(snap.issues, assessments, freeze + "T00:00:00Z", { areas }),
};

// The maintainers' own rejections in the 90 days before the freeze, each with their last comment.
function rejectionsBefore() {
  const start = D - Number(values["log-days"]) * DAY;
  const pool = [...raw.past_rejections, ...raw.issues];
  const seen = new Set();
  const out = [];
  for (const i of pool) {
    const closed = i.closed_at && new Date(i.closed_at).getTime();
    if (seen.has(i.number) || i.state_reason !== "not_planned" || !closed || closed < start || closed > D) continue;
    seen.add(i.number);
    const said = (i.comments || []).filter((c) => isMaintainer(c.author_association) && new Date(c.created_at).getTime() <= closed + 60000);
    if (!said.length) continue;
    out.push({ id: `D${i.number}`, labels: i.labels_now || [], reason: said[said.length - 1].body });
  }
  return out;
}
const rejections = rejectionsBefore();
const rules = await proposeRules(rejections, { model, cacheDir: cache("rules") });
log(`${rejections.length} past rejections with a reason, ${rules.length} rules kept`);

const runs = Number(values.runs);
const conditions = {};
for (const [name, ruleSet] of [["without_history", []], ["with_history", rules]]) {
  conditions[name] = [];
  for (let r = 0; r < runs; r++) {
    const plan = await pick(shorts[name], { model, rules: ruleSet, cacheDir: cache("rank"), run: r });
    conditions[name].push({
      do: summarize(plan.do.map((x) => x.number), outcomes, "completed"),
      skip: summarize(plan.skip.map((x) => x.number), outcomes, ["not_planned", "duplicate"]),
      plan,
    });
    log(`${name} run ${r + 1}: do ${conditions[name].at(-1).do.hits}/${plan.do.length}, skip ${conditions[name].at(-1).skip.hits}/${plan.skip.length}`);
  }
}

const base = Object.fromEntries(
  Object.entries(baselines(snap.issues, freeze + "T00:00:00Z")).map(([k, picks]) => [k, summarize(picks, outcomes, "completed")]),
);
const meanHits = (list, part) => {
  const h = list.map((x) => x[part].hits);
  return { mean: Number((h.reduce((a, b) => a + b, 0) / h.length).toFixed(2)), min: Math.min(...h), max: Math.max(...h), of: list.map((x) => x[part].of) };
};

const result = {
  repo: values.repo,
  freeze,
  window_days: Number(values.window),
  model: values.model,
  versions: { assess: ASSESS_VERSION, rank: RANK_VERSION, rules: RULES_VERSION },
  open_at_freeze: snap.issues.length,
  outcome_counts: Object.values(outcomes).reduce((m, o) => ((m[o] = (m[o] || 0) + 1), m), {}),
  quote_checks_failed: [...assessments.values()].filter((a) => a.checks && (a.checks.evidence === false || a.checks.vision === false)).length,
  rejections_used: rejections.length,
  recent_fixes_used: recentFixes.length,
  rules,
  summary: {
    without_history: { do: meanHits(conditions.without_history, "do"), skip: meanHits(conditions.without_history, "skip") },
    with_history: { do: meanHits(conditions.with_history, "do"), skip: meanHits(conditions.with_history, "skip") },
  },
  baselines: base,
  runs: conditions,
  model_calls: model.calls(),
  note: "Issue bodies are today's text; GitHub's REST API keeps no edit history. Comments edited after the freeze were dropped.",
};
await mkdir(path.join(root, "results"), { recursive: true });
const out = path.join(root, "results", `${slug}_${freeze}.json`);
await writeFile(out, JSON.stringify(result, null, 2));
log(`wrote ${out}`);
console.log(JSON.stringify({ freeze, open: result.open_at_freeze, outcome_counts: result.outcome_counts, summary: result.summary, baselines: base, model_calls: result.model_calls }, null, 1));
