#!/usr/bin/env node
// Install a release privately and verify real RPCs without model calls or user data.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { RuntimeManager, BASE_RELEASE } = require("../shell/electron/lib/updates");
const { HarnessManager } = require("../shell/electron/lib/harness");
const { verifyCompatibility } = require("../shell/electron/lib/harness-compatibility");
const { createDeepDeckPreset, setPresetDefault, removeDeepDeckPreset, SELECTION_NS } = require("../shell/electron/lib/subagents");
const directory = mkdtempSync(path.join(tmpdir(), "deepdeck-smoke-"));
const root = path.join(directory, "harness");
const manager = new RuntimeManager({ root, sourceHome: path.join(directory, "empty-source"), sourceAgentsHome: path.join(directory, "empty-agents") });
const full = process.argv.includes("--full");
const page = process.argv.includes("--page");
let probe;
async function verifyPage(url, slot) {
  const electron = require("../shell/electron/node_modules/electron");
  const script = fileURLToPath(new URL("./smoke-page.cjs", import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [script], { env: { ...process.env, DEEPDECK_SMOKE_ROOT: slot.base }, stdio: ["pipe", "inherit", "inherit"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Electron page verification timed out")); }, 120_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Electron verification exited ${code}`)); });
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify({ url }));
  });
}
try {
  if (process.argv.includes("--latest")) await manager.check();
  else manager.save({ pending: BASE_RELEASE });
  await manager.update({ onProgress: message => console.log(message), validate: async slot => {
    probe = new HarnessManager({ getRuntime: () => slot,
      getPreferences: () => ({ harness: { workdir: directory, port: 0 } }),
      getEnvironment: () => ({ PATH: process.env.PATH, LANG: "C.UTF-8" }),
      stateFile: path.join(slot.base, "probe.json"), logFile: path.join(slot.base, "probe.log"),
      logger: { info() {}, line() {} } });
    try {
      await probe.start();
      const rpc = probe.rpc();
      await verifyCompatibility(rpc);
      if (full) {
        const view = (await rpc.describeSettings()).namespaces.find(item => item.ns === SELECTION_NS);
        await rpc.updateSettings(SELECTION_NS, { enabled: true, allowedModels: [] }, view.revision);
        await rpc.setCredential("DEEPDECK_SMOKE_KEY", "temporary-smoke-value");
        const state = await rpc.describeCredentials(["DEEPDECK_SMOKE_KEY"]);
        if (state.DEEPDECK_SMOKE_KEY?.configured !== true) throw new Error("Credential status did not reflect the private write");
        await rpc.unsetCredential("DEEPDECK_SMOKE_KEY");
        await rpc.mutateSettings("llm-pi-ai", [{ op: "set", path: ["providers", "deepdeck-smoke"], value: {
          api: "openai-completions", baseURL: "http://127.0.0.1:9/v1", models: [{ id: "smoke" }],
        } }], (await rpc.describeSettings()).namespaces.find(item => item.ns === "llm-pi-ai").revision);
        if (!(await rpc.listProviders()).some(item => item.id === "deepdeck-smoke")) throw new Error("The private provider did not activate");
        await rpc.mutateSettings("llm-pi-ai", [{ op: "unset", path: ["providers", "deepdeck-smoke"] }],
          (await rpc.describeSettings()).namespaces.find(item => item.ns === "llm-pi-ai").revision);
        const preset = await createDeepDeckPreset(rpc, { home: slot.home });
        if (preset.change.application === "restart-required") await probe.restart();
        await setPresetDefault(probe.rpc(), "deepdeck-full");
        await verifyCompatibility(probe.rpc());
        const removed = await removeDeepDeckPreset(probe.rpc());
        if (removed.application === "restart-required") await probe.restart();
      }
      if (page) await verifyPage(probe.authenticatedUrl(), slot);
    } finally { await probe.stop(); }
  } });
  console.log(`SMOKE OK: ${manager.current().version}${page ? " including Electron page boot" : " (host RPC only)"}`);
} catch (error) {
  console.error(`SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await manager.close();
  try { await probe?.stop(); } finally { rmSync(directory, { recursive: true, force: true }); }
}
