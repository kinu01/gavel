import { test } from "node:test";
import assert from "node:assert/strict";
import { protectedTouches } from "../src/guard-diff.mjs";

test("workflow, Gavel state, vision, action and lock files are protected", () => {
  const hit = protectedTouches([
    "src/index.js",
    ".github/workflows/release.yml",
    ".gavel-state/decisions.jsonl",
    "VISION.md",
    "action.yml",
    "package-lock.json",
    "docs/VISION.md",
  ]);
  assert.deepEqual(hit, [".github/workflows/release.yml", ".gavel-state/decisions.jsonl", "VISION.md", "action.yml", "package-lock.json"]);
});

test("extra patterns from the maintainer are protected too", () => {
  assert.deepEqual(protectedTouches(["scripts/release.sh", "src/a.js"], ["^scripts/"]), ["scripts/release.sh"]);
});
