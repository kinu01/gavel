// Stage B: the model judges type, harm, effort and fit for each issue, in batches.
// Code then checks every quote against the source, so an invented reason counts as "unclear".
import { readFileSync } from "node:fs";
import { fenceIssues, FENCE_RULE, newNonce, clean, LIMITS } from "./fence.mjs";
import { cachedJson, hash } from "./cache.mjs";
import { withRetry } from "./model.mjs";

const PROMPT = readFileSync(new URL("../prompts/assess.md", import.meta.url), "utf8");
const SCHEMA = JSON.parse(readFileSync(new URL("../schemas/assessment.json", import.meta.url), "utf8"));
export const ASSESS_VERSION = hash(PROMPT + JSON.stringify(SCHEMA));
export const VISION_MAX = 4000;

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
export const quoteFound = (quote, source) => !quote || norm(source).includes(norm(quote));

export function card(issue) {
  return {
    number: issue.number,
    title: issue.title,
    labels: issue.labels,
    body: issue.body,
    comments: issue.comments.map((c) => ({ by: c.author_association === "NONE" ? "public" : c.author_association.toLowerCase(), body: c.body })),
  };
}

function sourceText(c) {
  return [clean(c.title, LIMITS.title), clean(c.body, LIMITS.body), ...c.comments.slice(-LIMITS.comments).map((x) => clean(x.body, LIMITS.comment))].join("\n");
}

export function verify(assessment, c, vision) {
  const a = { ...assessment, checks: { evidence: true, vision: true } };
  if (!quoteFound(a.evidence_quote, sourceText(c))) {
    a.checks.evidence = false;
    a.harm = "unclear";
  }
  if (a.fit !== "unclear" && (!a.vision_quote || !quoteFound(a.vision_quote, vision))) {
    a.checks.vision = false;
    a.fit = "unclear";
  }
  return a;
}

export async function assessAll(issues, { model, vision, batchSize = 40, cacheDir, onProgress = () => {} }) {
  const visionText = clean(vision, VISION_MAX);
  const cards = issues.map(card);
  const out = new Map();
  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);
    const key = { v: ASSESS_VERSION, model: model.model, vision: hash(visionText), batch };
    const result = await cachedJson(cacheDir, key, () =>
      withRetry(async () => {
        const nonce = newNonce();
        const system = `${PROMPT}\n\n${FENCE_RULE(nonce)}`;
        const prompt = `Project description (written by the maintainers, trusted):\n<vision>\n${visionText}\n</vision>\n\nOpen issues:\n${fenceIssues(batch, nonce)}`;
        const { data } = await model.call({ system, prompt, schema: SCHEMA });
        return data;
      }),
    );
    const wanted = new Set(batch.map((c) => c.number));
    for (const a of result.assessments) {
      if (!wanted.has(a.number)) throw new Error(`model returned issue #${a.number}, which was not in its batch`);
      out.set(a.number, verify(a, batch.find((c) => c.number === a.number), visionText));
    }
    onProgress(Math.min(i + batchSize, cards.length), cards.length);
  }
  for (const c of cards) {
    if (!out.has(c.number)) out.set(c.number, { number: c.number, type: "unclear", harm: "unclear", effort: "unclear", fit: "unclear", evidence_quote: "", vision_quote: "", checks: { missing: true } });
  }
  return out;
}
