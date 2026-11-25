import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotAt, outcomesAfter, isOpenAt } from "../src/snapshot.mjs";
import { features, demand } from "../src/features.mjs";

const FREEZE = "2026-08-01";
const raw = {
  repo: "o/r",
  issues: [
    {
      number: 1,
      title: "Crash on save (renamed later)",
      body: "steps",
      user: "alice",
      author_association: "NONE",
      created_at: "2026-07-01T00:00:00Z",
      closed_at: "2026-08-20T00:00:00Z",
      state: "closed",
      state_reason: "completed",
      comments: [
        { user: "bob", author_association: "NONE", created_at: "2026-07-02T00:00:00Z", updated_at: "2026-07-02T00:00:00Z", body: "same here" },
        { user: "maint", author_association: "MEMBER", created_at: "2026-08-05T00:00:00Z", updated_at: "2026-08-05T00:00:00Z", body: "fixed in #9" },
        { user: "carol", author_association: "NONE", created_at: "2026-07-03T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", body: "edited after the freeze" },
      ],
      reactions: [
        { content: "+1", created_at: "2026-07-05T00:00:00Z" },
        { content: "+1", created_at: "2026-08-10T00:00:00Z" },
      ],
      timeline: [
        { event: "labeled", label: "bug", created_at: "2026-07-01T01:00:00Z" },
        { event: "labeled", label: "confirmed", created_at: "2026-08-03T00:00:00Z" },
        { event: "renamed", rename: { from: "Crash on save", to: "Crash on save (renamed later)" }, created_at: "2026-08-04T00:00:00Z" },
        { event: "cross-referenced", source_issue: { number: 9, is_pr: true }, created_at: "2026-08-06T00:00:00Z" },
        { event: "cross-referenced", source_issue: { number: 7, is_pr: false }, created_at: "2026-07-20T00:00:00Z" },
      ],
    },
    { number: 2, title: "Born after", body: "", created_at: "2026-08-02T00:00:00Z", comments: [], reactions: [], timeline: [] },
    {
      number: 3, title: "Closed before, reopened before", body: "", created_at: "2026-06-01T00:00:00Z",
      closed_at: "2026-09-10T00:00:00Z", state_reason: "not_planned", comments: [], reactions: [],
      timeline: [
        { event: "closed", created_at: "2026-06-10T00:00:00Z" },
        { event: "reopened", created_at: "2026-06-20T00:00:00Z" },
      ],
    },
    {
      number: 4, title: "Closed before freeze", body: "", created_at: "2026-06-01T00:00:00Z",
      closed_at: "2026-07-15T00:00:00Z", state_reason: "completed", comments: [], reactions: [], timeline: [],
    },
  ],
};

test("only issues open at the freeze are in the snapshot", () => {
  const snap = snapshotAt(raw, FREEZE);
  assert.deepEqual(snap.issues.map((i) => i.number), [1, 3]);
  assert.equal(isOpenAt(raw.issues[3], FREEZE), false);
});

test("nothing dated after the freeze leaks into the snapshot", () => {
  const [one] = snapshotAt(raw, FREEZE).issues;
  assert.equal(one.title, "Crash on save");
  assert.deepEqual(one.labels, ["bug"]);
  assert.deepEqual(one.comments.map((c) => c.user), ["bob"]);
  assert.equal(one.reactions.length, 1);
  assert.equal(one.linked_prs, 0);
  assert.equal(one.linked_issues, 1);
});

test("outcomes count only closes inside the window", () => {
  assert.deepEqual(outcomesAfter(raw, FREEZE, 56), { 1: "completed", 3: "not_planned" });
  assert.deepEqual(outcomesAfter(raw, FREEZE, 30), { 1: "completed", 3: "still_open" });
});

test("features count non-maintainer people and freeze-time reactions", () => {
  const [one] = snapshotAt(raw, FREEZE).issues;
  const f = features(one, FREEZE);
  assert.equal(f.reporters, 2);
  assert.equal(f.thumbs, 1);
  assert.equal(f.maintainer_replied, false);
  assert.equal(f.age_days, 31);
  assert.equal(demand(f), Math.log2(3) + Math.log2(2) + 2 * Math.log2(2));
});
