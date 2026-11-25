// Shared by the backtest and live mode: list issue numbers with search, then pull each batch of
// issues with one GraphQL call, which is far fewer calls than the REST API needs.
import { pool } from "./github.mjs";

export async function searchNumbers(gh, q) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const res = await gh.get(`/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
    out.push(...res.items);
    if (res.items.length < 100) break;
  }
  if (out.length >= 1000) throw new Error(`search hit the 1000 result cap, split the range: ${q}`);
  return out.map((i) => i.number);
}

export const FIELDS = `number title body createdAt updatedAt closedAt lastEditedAt state stateReason
  author { login } authorAssociation labels(first: 30) { nodes { name } }
  comments(first: 100) { nodes { author { login } authorAssociation createdAt updatedAt lastEditedAt body } }
  reactions(first: 100) { nodes { content createdAt } }
  timelineItems(first: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, RENAMED_TITLE_EVENT, CLOSED_EVENT, REOPENED_EVENT, CROSS_REFERENCED_EVENT]) {
    nodes { __typename
      ... on LabeledEvent { createdAt label { name } }
      ... on UnlabeledEvent { createdAt label { name } }
      ... on RenamedTitleEvent { createdAt previousTitle currentTitle }
      ... on ClosedEvent { createdAt }
      ... on ReopenedEvent { createdAt }
      ... on CrossReferencedEvent { createdAt source { __typename ... on PullRequest { number state } ... on Issue { number } } }
    } }`;

export async function fetchIssues(gh, repo, numbers, { batch = 15, concurrency = 3, onBatch = () => {} } = {}) {
  const [owner, name] = repo.split("/");
  const batches = [];
  for (let i = 0; i < numbers.length; i += batch) batches.push(numbers.slice(i, i + batch));
  let done = 0;
  const nodes = (
    await pool(batches, concurrency, async (b) => {
      const q = `query { repository(owner: "${owner}", name: "${name}") { ${b.map((n) => `i${n}: issue(number: ${n}) { ${FIELDS} }`).join("\n")} } }`;
      const data = await gh.graphql(q);
      onBatch(++done, batches.length);
      return Object.values(data.repository).filter(Boolean);
    })
  ).flat();
  return { nodes, issues: nodes.map(toIssue) };
}

const REACTION = { THUMBS_UP: "+1", THUMBS_DOWN: "-1", HEART: "heart", HOORAY: "hooray", LAUGH: "laugh", CONFUSED: "confused", ROCKET: "rocket", EYES: "eyes" };
const EVENT = { LabeledEvent: "labeled", UnlabeledEvent: "unlabeled", RenamedTitleEvent: "renamed", ClosedEvent: "closed", ReopenedEvent: "reopened", CrossReferencedEvent: "cross-referenced" };
export const toIssue = (n) => ({
  number: n.number,
  title: n.title,
  body: n.body || "",
  user: n.author?.login,
  author_association: n.authorAssociation,
  created_at: n.createdAt,
  updated_at: n.updatedAt,
  closed_at: n.closedAt,
  body_edited_at: n.lastEditedAt,
  state: n.state.toLowerCase(),
  state_reason: n.stateReason?.toLowerCase() || null,
  labels_now: n.labels.nodes.map((l) => l.name),
  comments: n.comments.nodes.map((c) => ({
    user: c.author?.login,
    author_association: c.authorAssociation,
    created_at: c.createdAt,
    updated_at: c.lastEditedAt || c.createdAt,
    body: c.body || "",
  })),
  reactions: n.reactions.nodes.map((r) => ({ content: REACTION[r.content] || r.content, created_at: r.createdAt })),
  timeline: n.timelineItems.nodes.map((e) => ({
    event: EVENT[e.__typename],
    created_at: e.createdAt,
    label: e.label?.name,
    rename: e.__typename === "RenamedTitleEvent" ? { from: e.previousTitle, to: e.currentTitle } : undefined,
    source_issue: e.source?.number ? { number: e.source.number, is_pr: e.source.__typename === "PullRequest", state: e.source.state?.toLowerCase() } : undefined,
  })),
});
