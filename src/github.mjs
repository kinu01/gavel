import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ghRaw(args) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }));
      else resolve(stdout);
    });
  });
}

const notRetryable = (err) => /HTTP (404|410|422)/.test(err.stderr || "");

export function createClient({ cacheDir = null, retries = 5, maxReads = Infinity, run = ghRaw } = {}) {
  let reads = 0;

  async function cached(key, fetcher) {
    if (!cacheDir) return fetcher();
    const file = path.join(cacheDir, createHash("sha1").update(key).digest("hex") + ".json");
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {}
    const value = await fetcher();
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  }

  async function get(endpoint) {
    return cached(endpoint, async () => {
      if (reads >= maxReads) throw new Error(`read cap of ${maxReads} reached`);
      reads++;
      for (let attempt = 0; ; attempt++) {
        try {
          return JSON.parse(await run(["api", "-H", "Accept: application/vnd.github+json", endpoint]));
        } catch (err) {
          if (notRetryable(err) || attempt >= retries) throw err;
          await sleep(1000 * 2 ** attempt);
        }
      }
    });
  }

  async function getAll(endpoint, { perPage = 100, maxPages = 50 } = {}) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await get(`${endpoint}${sep}per_page=${perPage}&page=${page}`);
      const items = Array.isArray(batch) ? batch : batch.items || [];
      out.push(...items);
      if (items.length < perPage) break;
    }
    return out;
  }

  async function graphql(query) {
    return cached(query, async () => {
      if (reads >= maxReads) throw new Error(`read cap of ${maxReads} reached`);
      reads++;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = JSON.parse(await run(["api", "graphql", "-f", `query=${query}`]));
          if (res.errors?.length) throw Object.assign(new Error(res.errors[0].message), { stderr: "" });
          return res.data;
        } catch (err) {
          if (attempt >= retries) throw err;
          await sleep(1000 * 2 ** attempt);
        }
      }
    });
  }

  return { get, getAll, graphql, reads: () => reads };
}

export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
