/**
 * Local dashboard: auth bypass + real Hermes (clears SCORE_MOCK).
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

delete process.env.SCORE_MOCK;
process.env.LEADRADAR_AUTH_BYPASS = "1";

const child = spawn(
  process.execPath,
  [resolve("node_modules/tsx/dist/cli.mjs"), "src/dashboard/server.ts"],
  {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
