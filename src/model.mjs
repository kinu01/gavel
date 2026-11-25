// The only place a model is called. The model gets no tools, no MCP servers and no user settings,
// so whatever an issue says, the model can only return JSON that must match a schema.
import { spawn } from "node:child_process";

export function createModel({ model = "claude-sonnet-5-5", maxCalls = 60, command = "claude", cwd } = {}) {
  let calls = 0;

  function call({ system, prompt, schema }) {
    if (calls >= maxCalls) return Promise.reject(new Error(`model call cap of ${maxCalls} reached`));
    calls++;
    const args = [
      "-p", "--tools", "", "--strict-mcp-config", "--setting-sources", "",
      "--system-prompt", system, "--output-format", "json",
      "--json-schema", JSON.stringify(schema), "--no-session-persistence", "--model", model,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          const res = JSON.parse(out);
          if (res.is_error || !res.structured_output) throw new Error(res.result || "no structured output");
          resolve({ data: res.structured_output, cost: res.total_cost_usd ?? 0 });
        } catch (e) {
          reject(new Error(`model call failed (exit ${code}): ${e.message} ${err.slice(0, 300)}`));
        }
      });
      child.stdin.end(prompt);
    });
  }

  return { call, calls: () => calls, model };
}

export async function withRetry(fn, tries = 2) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= tries || /call cap/.test(e.message)) throw e;
    }
  }
}
