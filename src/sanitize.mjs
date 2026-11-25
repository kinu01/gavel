// Model text is posted to GitHub. It must not mention people, link anywhere, embed images or HTML,
// or forge the checkbox lines that record a maintainer's decision.
export function sanitizeText(text, max = 200) {
  let s = String(text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(/\bwww\.\S+/gi, "[link removed]")
    .replace(/@(?=[A-Za-z0-9-])/g, "")
    .replace(/\[[ xX]\]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[`|]/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max - 3).trimEnd() + "...";
  return s;
}
