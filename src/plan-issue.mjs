// Renders the weekly plan as a GitHub issue body, and reads the maintainer's ticks back.
// Only lines that start with a checkbox followed by Gavel's hidden marker count. Titles and reasons
// are sanitized, so text from the public can never contain a marker or a checkbox.
import { sanitizeText } from "./sanitize.mjs";

export const LABEL = "gavel-plan";
const DATA = /<!--gavel-plan (\{[\s\S]*?\})-->/;
const LINE = /^- \[( |x|X)\] <!--g:(do|skip|rule):([A-Za-z0-9]+)-->/;

export function renderPlan(plan) {
  const item = (kind) => (x) => `- [ ] <!--g:${kind}:${x.number}--> #${x.number} ${sanitizeText(x.title, 90)}: ${sanitizeText(x.reason, 200)}`;
  const rule = (r) => `- [ ] <!--g:rule:${r.id}--> ${r.id}: ${sanitizeText(r.text, 200)} (from ${r.cites.join(", ")})`;
  const lines = [
    `Gavel read ${plan.read.issues} of ${plan.read.total} open issues and suggests the lists below.`,
    "",
    "Tick what you approve. To give a reason, comment with lines like `#123 no: too big for now` or `#123 yes: users keep hitting this`. When you are done, close this issue to confirm. Gavel records your decisions and learns from the reasons.",
    "",
    "### Work on these",
    ...(plan.do.length ? plan.do.map(item("do")) : ["Nothing this week."]),
    "",
    "### Safe to decline",
    ...(plan.skip.length ? plan.skip.map(item("skip")) : ["Nothing this week."]),
  ];
  if (plan.proposed_rules?.length) lines.push("", "### Proposed rules (tick to turn on)", ...plan.proposed_rules.map(rule));
  if (plan.track_record?.length) {
    lines.push("", "### Track record so far", "", "| Category | Approved | Merged | Reverted |", "|---|---|---|---|");
    for (const t of plan.track_record) lines.push(`| ${t.category} | ${t.approved} | ${t.merged} | ${t.reverted} |`);
  }
  const data = { plan_id: plan.plan_id, do: plan.do.map((x) => x.number), skip: plan.skip.map((x) => x.number), rules: (plan.proposed_rules || []).map((r) => r.id), rule_defs: (plan.proposed_rules || []).map((r) => ({ id: r.id, text: sanitizeText(r.text, 200), cites: r.cites })), meta: plan.meta };
  lines.push("", `<!--gavel-plan ${JSON.stringify(data).replace(/--/g, "")}-->`);
  return lines.join("\n");
}

export function readTicks(body) {
  const m = String(body).match(DATA);
  if (!m) throw new Error("not a Gavel plan issue: the plan data block is missing");
  const data = JSON.parse(m[1]);
  const allowed = { do: new Set(data.do.map(String)), skip: new Set(data.skip.map(String)), rule: new Set(data.rules) };
  const ticks = { do: {}, skip: {}, rule: {} };
  for (const line of String(body).split("\n")) {
    const l = line.match(LINE);
    if (!l) continue;
    const [, box, kind, id] = l;
    if (!allowed[kind].has(id)) continue;
    ticks[kind][id] = box.toLowerCase() === "x";
  }
  return { data, ticks };
}

const REASON = /^\s*#(\d+)\s+(yes|no)\s*:\s*(.+)$/i;
export function readReasons(comments) {
  const out = {};
  for (const c of comments) for (const line of String(c.body).split("\n")) {
    const m = line.match(REASON);
    if (m) out[m[1]] = { vote: m[2].toLowerCase(), reason: m[3].trim().slice(0, 300), by: c.user };
  }
  return out;
}

export function decide({ data, ticks }, reasons, { by, ts = new Date().toISOString() }) {
  const out = [];
  for (const kind of ["do", "skip"]) {
    for (const n of data[kind]) {
      const id = String(n);
      const r = reasons[id];
      let human = ticks[kind][id] ? "approve" : "defer";
      if (r?.vote === "yes") human = "approve";
      if (r?.vote === "no") human = "reject";
      out.push({ ts, plan_id: data.plan_id, issue: n, planner: kind, human, reason: r?.reason || "", by: r?.by || by });
    }
  }
  const activated = data.rules.filter((id) => ticks.rule[id]);
  return { decisions: out, activated };
}
