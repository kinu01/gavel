// v2: after the builder writes code, fail the job if it touched files that control CI, releases or
// Gavel itself. A builder steered by issue text must not be able to change its own guardrails.
export const PROTECTED = [/^\.github\//, /^\.gavel/, /^VISION\.md$/, /^action\.ya?ml$/, /(^|\/)\.env/, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/];

export function protectedTouches(paths, extra = []) {
  const rules = [...PROTECTED, ...extra.map((p) => new RegExp(p))];
  return paths.filter((p) => rules.some((r) => r.test(p)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = (await new Response(process.stdin).text()).split("\n").map((s) => s.trim()).filter(Boolean);
  const hit = protectedTouches(input, process.argv.slice(2));
  if (hit.length) {
    console.error(`Gavel stopped this change because it touches protected files:\n${hit.join("\n")}`);
    process.exit(1);
  }
  console.error(`guard-diff: ${input.length} changed files, none protected`);
}
