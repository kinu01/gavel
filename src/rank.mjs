// Stage C (code) narrows the field with a fixed score. Stage D (model) picks the final do and skip lists.
import { readFileSync } from "node:fs";
import { features, demand } from "./features.mjs";
import { focusOf } from "./focus.mjs";
import { fenceIssues, FENCE_RULE, newNonce } from "./fence.mjs";
import { sanitizeText } from "./sanitize.mjs";
import { cachedJson, hash } from "./cache.mjs";
import { withRetry } from "./model.mjs";

const PROMPT = readFileSync(new URL("../prompts/rank.md", import.meta.url), "utf8");
const SCHEMA = JSON.parse(readFileSync(new URL("../schemas/plan.json", import.meta.url), "utf8"));
export const RANK_VERSION = hash(PROMPT + JSON.stringify(SCHEMA));

const HARM = { security: 4, data_loss: 4, crash: 3, wrong_result: 2, degraded: 1, cosmetic: 0, none: 0, unclear: 0 };
const FIT = { in: 1, unclear: 0, out: -3 };
const EFFORT = { S: 0, M: 0.5, L: 1.5, XL: 3, unclear: 1 };
const SKIP_TYPES = new Set(["question", "duplicate", "invalid"]);

const freshness = (f) => (f.age_days <= 14 ? 2 : f.age_days <= 60 ? 1 : 0) + Math.log2(1 + f.comments_30d);

export function score(f, a, focus = 0) {
  return demand(f) + freshness(f) + 4 * focus + (HARM[a.harm] ?? 0) + (FIT[a.fit] ?? 0) - (EFFORT[a.effort] ?? 1);
}

export function shortlist(issues, assessments, freeze, { doCount = 30, skipCount = 20, areas = null } = {}) {
  const rows = issues.map((issue) => {
    const f = features(issue, freeze);
    const a = assessments.get(issue.number);
    const focus = areas ? focusOf(issue.labels, areas) : null;
    return { issue, f, a, focus, score: score(f, a, focus || 0) };
  });
  const isSkip = (r) => r.a.fit === "out" || SKIP_TYPES.has(r.a.type);
  const doRows = rows.filter((r) => !isSkip(r)).sort((x, y) => y.score - x.score).slice(0, doCount);
  const skipRows = rows.filter(isSkip).sort((x, y) => x.score - y.score).slice(0, skipCount);
  return { doRows, skipRows };
}

const candidate = ({ issue, f, a, focus }) => ({
  number: issue.number,
  title: issue.title,
  type: a.type, harm: a.harm, effort: a.effort, fit: a.fit,
  quote: a.evidence_quote,
  reporters: f.reporters, thumbs: f.thumbs, linked_issues: f.linked_issues, comment_count: f.comments,
  age_days: f.age_days, comments_last_30_days: f.comments_30d, maintainer_replied: f.maintainer_replied, linked_prs: f.linked_prs,
  ...(focus === null ? {} : { labels: issue.labels, current_focus: Number(focus.toFixed(2)) }),
});

function check(list, allowed, ruleIds) {
  const seen = new Set();
  return list
    .filter((x) => {
      if (!allowed.has(x.number)) throw new Error(`model picked #${x.number}, which was not a candidate`);
      if (seen.has(x.number)) return false;
      seen.add(x.number);
      return true;
    })
    .map((x) => ({ number: x.number, reason: sanitizeText(x.reason, 200), rule_ids: x.rule_ids.filter((id) => ruleIds.has(id)) }));
}

export async function pick({ doRows, skipRows }, { model, rules = [], cacheDir, run = 0 }) {
  const cards = [...doRows, ...skipRows].map(candidate);
  const rulesText = rules.length ? rules.map((r) => `${r.id}: ${r.text}`).join("\n") : "(none yet)";
  const key = { v: RANK_VERSION, model: model.model, cards, rulesText, run };
  const data = await cachedJson(cacheDir, key, () =>
    withRetry(async () => {
      const nonce = newNonce();
      const system = `${PROMPT}\n\n${FENCE_RULE(nonce)}`;
      const prompt = `Maintainer rules (trusted):\n<rules>\n${rulesText}\n</rules>\n\nCandidates (titles and quotes come from the public):\n${fenceIssues(cards, nonce)}`;
      return (await model.call({ system, prompt, schema: SCHEMA })).data;
    }),
  );
  const allowed = new Set(cards.map((c) => c.number));
  const ruleIds = new Set(rules.map((r) => r.id));
  const doList = check(data.do, allowed, ruleIds);
  const doSet = new Set(doList.map((x) => x.number));
  return { do: doList, skip: check(data.skip, allowed, ruleIds).filter((x) => !doSet.has(x.number)) };
}
