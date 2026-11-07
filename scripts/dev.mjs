#!/usr/bin/env node
/**
 * Development runner: Vite serves the shell SPA, Electron loads that origin and
 * manages the harness exactly as in production. Stop with Ctrl+C.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const shell = path.join(root, "shell", "electron");
const electron = path.join(shell, "node_modules", "electron", "dist", "electron");
const port = Number(process.env.DEEPDECK_DEV_PORT || 5199);
const origin = `http://127.0.0.1:${port}`;

const vite = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "--port", String(port)], {
  cwd: frontend,
  stdio: "inherit",
});

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch { /* not ready */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not start in time");
}

let app = null;
function shutdown(code = 0) {
  try { app?.kill("SIGTERM"); } catch { /* gone */ }
  try { vite.kill("SIGTERM"); } catch { /* gone */ }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  await waitForVite();
  app = spawn(electron, [shell], {
    cwd: shell,
    env: { ...process.env, DEEPDECK_SHELL_URL: origin },
    stdio: "inherit",
  });
  app.once("exit", code => shutdown(code ?? 0));
} catch (error) {
  console.error(error.message);
  shutdown(1);
}
