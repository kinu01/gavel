// Downloads everything the backtest needs for one repo into eval/data/<owner>__<repo>/raw.json.
// Lists issue numbers with the search API, then pulls each batch of issues in one GraphQL call.
// Usage: node eval/fetch.mjs --repo biomejs/biome --freeze 2026-07-13 --freeze 2026-08-03 --freeze 2026-08-31
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { createClient, pool } from "../src/github.mjs";
import { searchNumbers, fetchIssues } from "../src/collect.mjs";

const DAY = 86400000;
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    freeze: { type: "string", multiple: true },
    "log-days": { type: "string", default: "90" },
    batch: { type: "string", default: "15" },
    concurrency: { type: "string", default: "3" },
  },
});
const repo = values.repo;
const freezes = values.freeze.map((d) => new Date(d + "T00:00:00Z")).sort((a, b) => a - b);
const first = freezes[0];
const last = freezes[freezes.length - 1];
const logStart = new Date(first - Number(values["log-days"]) * DAY);
const root = import.meta.dirname;
const gh = createClient({ cacheDir: path.join(root, "cache", repo.replace("/", "__")) });
const day = (d) => d.toISOString().slice(0, 10);
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// Search returns at most 1000 results, so closed issues are listed one month at a time.
const queries = [`repo:${repo} is:issue is:open created:<=${day(last)}`];
for (let s = new Date(logStart); s < new Date(); s = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1))) {
  const e = new Date(Math.min(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0), Date.now()));
  queries.push(`repo:${repo} is:issue is:closed created:<=${day(last)} closed:${day(s)}..${day(e)}`);
}
const numbers = [...new Set((await pool(queries, 2, (q) => searchNumbers(gh, q))).flat())].sort((a, b) => a - b);
log(`${numbers.length} issues listed with ${queries.length} searches`);

const { nodes, issues } = await fetchIssues(gh, repo, numbers, {
  batch: Number(values.batch),
  concurrency: Number(values.concurrency),
  onBatch: (d, t) => d % 10 === 0 && log(`batch ${d}/${t}`),
});


const readmes = {};
for (const d of freezes) {
  const [commit] = await gh.get(`/repos/${repo}/commits?until=${d.toISOString()}&per_page=1`);
  const file = await gh.get(`/repos/${repo}/contents/README.md?ref=${commit.sha}`);
  readmes[day(d)] = { sha: commit.sha, text: Buffer.from(file.content, "base64").toString("utf8") };
}

const capped = nodes.filter((n) => n.comments.nodes.length === 100 || n.reactions.nodes.length === 100 || n.timelineItems.nodes.length === 100).length;
const out = {
  repo,
  fetched_at: new Date().toISOString(),
  freezes: freezes.map(day),
  log_start: day(logStart),
  readmes,
  issues: issues.filter((i) => new Date(i.created_at) <= last && (i.state === "open" || new Date(i.closed_at) > first)),
  past_rejections: issues.filter((i) => i.state_reason === "not_planned" && new Date(i.closed_at) <= first),
  past_completed: issues.filter((i) => i.state_reason === "completed" && new Date(i.closed_at) <= first).map((i) => ({ number: i.number, closed_at: i.closed_at, labels_now: i.labels_now })),
  issues_with_capped_lists: capped,
};
const dir = path.join(root, "data", repo.replace("/", "__"));
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "raw.json"), JSON.stringify(out));
log(`wrote ${out.issues.length} candidate issues, ${out.past_rejections.length} earlier rejections, ${capped} issues hit a 100-item list cap, ${gh.reads()} network calls`);
