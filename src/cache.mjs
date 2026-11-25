import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const hash = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);

export async function cachedJson(dir, key, fn) {
  if (!dir) return fn();
  const file = path.join(dir, hash(key) + ".json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {}
  const value = await fn();
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
}
