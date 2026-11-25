// Turns repeated rejection reasons into proposed rules. Code throws away any rule that does not
// cite at least MIN_CITES real rejections. In live mode a rule becomes active only when ticked.
import { readFileSync } from "node:fs";
import { fenceIssues, FENCE_RULE, newNonce, clean } from "./fence.mjs";
import { sanitizeText } from "./sanitize.mjs";
import { cachedJson, hash } from "./cache.mjs";
import { withRetry } from "./model.mjs";

const PROMPT = readFileSync(new URL("../prompts/rules.md", import.meta.url), "utf8");
const SCHEMA = JSON.parse(readFileSync(new URL("../schemas/rules.json", import.meta.url), "utf8"));
export const RULES_VERSION = hash(PROMPT + JSON.stringify(SCHEMA));
export const MIN_CITES = 3;

export function validateRules(proposed, rejections) {
  const real = new Set(rejections.map((r) => r.id));
  return proposed
    .map((r) => ({ text: sanitizeText(r.text, 200), cites: [...new Set(r.cites)].filter((id) => real.has(id)) }))
    .filter((r) => r.text && r.cites.length >= MIN_CITES)
    .map((r, i) => ({ id: `R${i + 1}`, status: "proposed", ...r }));
}

export async function proposeRules(rejections, { model, cacheDir }) {
  if (rejections.length < MIN_CITES) return [];
  const items = rejections.map((r) => ({ number: r.id, title: r.labels.join(", ") || "(no labels)", body: clean(r.reason, 300) }));
  const key = { v: RULES_VERSION, model: model.model, items };
  const data = await cachedJson(cacheDir, key, () =>
    withRetry(async () => {
      const nonce = newNonce();
      const system = `${PROMPT}\n\n${FENCE_RULE(nonce)}\nIn the block below, "number" is the decision id, "title" holds the issue's labels and "body" holds the maintainer's reason.`;
      return (await model.call({ system, prompt: `Past decisions to decline:\n${fenceIssues(items, nonce)}`, schema: SCHEMA })).data;
    }),
  );
  return validateRules(data.rules, rejections);
}
