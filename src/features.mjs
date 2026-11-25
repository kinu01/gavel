// Counts that code can measure exactly. The model never computes these.
import { isMaintainer } from "./snapshot.mjs";

const DAY = 86400000;

export function features(issue, freeze) {
  const d = new Date(freeze).getTime();
  const people = new Set();
  if (!isMaintainer(issue.author_association)) people.add(issue.author);
  for (const c of issue.comments) if (!isMaintainer(c.author_association)) people.add(c.user);
  people.delete(undefined);

  const count = (content) => issue.reactions.filter((r) => r.content === content).length;
  const thumbs = count("+1") + count("heart");
  const recent = issue.comments.filter((c) => d - new Date(c.created_at).getTime() <= 30 * DAY).length;

  return {
    reporters: people.size,
    thumbs,
    thumbs_down: count("-1"),
    comments: issue.comments.length,
    comments_30d: recent,
    age_days: Math.floor((d - new Date(issue.created_at).getTime()) / DAY),
    maintainer_replied: issue.comments.some((c) => isMaintainer(c.author_association)),
    linked_prs: issue.linked_prs,
    linked_issues: issue.linked_issues,
  };
}

// Weights fixed before any backtest run, so they cannot be tuned to the answers.
export function demand(f) {
  return Math.log2(1 + f.reporters) + Math.log2(1 + f.thumbs) + 2 * Math.log2(1 + f.linked_issues);
}
