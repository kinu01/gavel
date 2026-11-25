// Rebuilds what a repo's issue list looked like at a past moment, using only data dated at or before it.
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const isMaintainer = (association) => MAINTAINER.has(association);

const at = (s) => new Date(s).getTime();

export function isOpenAt(issue, freeze) {
  const d = at(freeze);
  if (at(issue.created_at) > d) return false;
  const changes = (issue.timeline || [])
    .filter((e) => (e.event === "closed" || e.event === "reopened") && at(e.created_at) <= d)
    .sort((a, b) => at(a.created_at) - at(b.created_at));
  if (changes.length) return changes[changes.length - 1].event === "reopened";
  return !issue.closed_at || at(issue.closed_at) > d;
}

function titleAt(issue, d) {
  const later = (issue.timeline || [])
    .filter((e) => e.event === "renamed" && e.rename && at(e.created_at) > d)
    .sort((a, b) => at(a.created_at) - at(b.created_at));
  return later.length ? later[0].rename.from : issue.title;
}

function labelsAt(issue, d) {
  const labels = new Set();
  for (const e of [...(issue.timeline || [])].sort((a, b) => at(a.created_at) - at(b.created_at))) {
    if (at(e.created_at) > d || !e.label) continue;
    if (e.event === "labeled") labels.add(e.label);
    if (e.event === "unlabeled") labels.delete(e.label);
  }
  return [...labels];
}

export function snapshotAt(raw, freeze) {
  const d = at(freeze);
  const issues = raw.issues
    .filter((i) => isOpenAt(i, freeze))
    .map((i) => {
      const refs = (i.timeline || []).filter((e) => e.event === "cross-referenced" && e.source_issue && at(e.created_at) <= d);
      return {
        number: i.number,
        title: titleAt(i, d),
        body: i.body,
        author: i.user,
        author_association: i.author_association,
        created_at: i.created_at,
        labels: labelsAt(i, d),
        comments: (i.comments || []).filter((c) => at(c.created_at) <= d && at(c.updated_at || c.created_at) <= d),
        reactions: (i.reactions || []).filter((r) => at(r.created_at) <= d),
        linked_prs: refs.filter((e) => e.source_issue.is_pr).length,
        linked_issues: refs.filter((e) => !e.source_issue.is_pr).length,
      };
    });
  return { repo: raw.repo, freeze_at: new Date(d).toISOString().slice(0, 10), issues };
}

// What really happened after the freeze. Never shown to the planner.
export function outcomesAfter(raw, freeze, windowDays = 56) {
  const d = at(freeze);
  const end = d + windowDays * 86400000;
  const out = {};
  for (const i of raw.issues) {
    if (!isOpenAt(i, freeze)) continue;
    const closed = i.closed_at && at(i.closed_at) > d && at(i.closed_at) <= end;
    out[i.number] = closed ? i.state_reason || "closed" : "still_open";
  }
  return out;
}
