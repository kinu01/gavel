// The decision log is an append-only JSON Lines file on the gavel-state branch of the target repo.
import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function readJsonl(file) {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

export async function appendJsonl(file, rows) {
  if (!rows.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

// Rejections the rules step may learn from: work the planner suggested that the maintainer refused,
// and work the maintainer agreed to decline, each only when a reason was given.
export function learnable(decisions) {
  return decisions
    .filter((d) => d.reason && ((d.planner === "do" && d.human === "reject") || (d.planner === "skip" && d.human === "approve")))
    .map((d) => ({ id: `D${d.issue}`, labels: d.labels || [], reason: d.reason }));
}

export function trackRecord(decisions, events = []) {
  const rows = {};
  const row = (c) => (rows[c] ??= { category: c, approved: 0, merged: 0, reverted: 0 });
  for (const d of decisions) if (d.planner === "do" && d.human === "approve") row(d.category || "uncategorized").approved++;
  for (const e of events) {
    if (e.event === "merged") row(e.category || "uncategorized").merged++;
    if (e.event === "reverted") row(e.category || "uncategorized").reverted++;
  }
  return Object.values(rows);
}
