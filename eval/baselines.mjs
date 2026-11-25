// Simple ways to pick 10 issues without any model. Gavel only adds value if it beats them.
import { features } from "../src/features.mjs";

const top = (issues, freeze, key, n) =>
  issues
    .map((i) => ({ number: i.number, value: key(features(i, freeze), i) }))
    .sort((a, b) => b.value - a.value || b.number - a.number)
    .slice(0, n)
    .map((x) => x.number);

export function baselines(issues, freeze, n = 10) {
  return {
    most_thumbs_up: top(issues, freeze, (f) => f.thumbs, n),
    newest: top(issues, freeze, (_f, i) => new Date(i.created_at).getTime(), n),
    most_comments: top(issues, freeze, (f) => f.comments, n),
    has_linked_pr: top(issues, freeze, (f) => (f.linked_prs > 0 ? 1e6 : 0) + f.comments, n),
  };
}
