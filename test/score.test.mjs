import { test } from "node:test";
import assert from "node:assert/strict";
import { randomTail, summarize } from "../eval/score.mjs";

test("random tail matches a hand-computed case", () => {
  // 10 issues, 3 fixed, pick 2: P(at least 1 hit) = 1 - C(7,2)/C(10,2) = 1 - 21/45
  assert.ok(Math.abs(randomTail(10, 3, 2, 1) - (1 - 21 / 45)) < 1e-9);
  assert.equal(randomTail(10, 3, 2, 0), 1);
});

test("summary reports hits, base rate and lift", () => {
  const outcomes = { 1: "completed", 2: "still_open", 3: "completed", 4: "not_planned" };
  const s = summarize([1, 2], outcomes, "completed");
  assert.equal(s.hits, 1);
  assert.equal(s.of, 2);
  assert.equal(s.base_rate, 0.5);
  assert.equal(s.lift, 1);
});
