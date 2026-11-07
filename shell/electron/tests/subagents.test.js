const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadSubagents, saveSubagents, backendStatus, createDeepDeckPreset, setPresetDefault,
  removeDeepDeckPreset, installBackend, removeBackend, preparePresets, SELECTION_NS, PRESET_NS, PRESET_PACKAGE, BUNDLES } = require("../lib/subagents");
const { verifyCompatibility } = require("../lib/harness-compatibility");

function rpcFixture() {
  const calls = [];
  const settings = { writable: true, namespaces: [
    { ns: SELECTION_NS, revision: 7, value: { enabled: true, allowedModels: [{ provider: "test", model: "m" }] } },
    { ns: PRESET_NS, revision: 11, value: { selectedDefault: "standard" } },
    { ns: "llm-pi-ai", revision: 1, value: {} },
    { ns: "agent-default-model", revision: 1, value: {} },
    { ns: "ui-theme", revision: 1, value: {} },
  ] };
  const bundles = [{ name: BUNDLES.codex.package, availability: "missing", installed: false, enabled: false,
    installTarget: { spec: `${BUNDLES.codex.package}@0.2.2-alpha.3`, version: "0.2.2-alpha.3" } }];
  const roster = { presets: [{ id: "standard", isDefault: true }, { id: "deepdeck-full", isDefault: false }] };
  const content = "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n  disabled: !!js process.platform === 'win32'\n";
  const rpc = {
    describeSettings: async () => settings,
    listProviders: async () => [{ id: "test", name: "Test" }],
    listConfigurableProviders: async () => [{ provider: "test", settingsNs: "llm-pi-ai", settingsPath: ["providers", "test"] }],
    describeCredentials: async () => ({}), discoverModels: async () => [{ id: "m", name: "Model" }],
    listBundles: async () => bundles, listPresets: async () => roster, listPlugins: async () => [],
    readPreset: async () => ({ content }),
    mutateSettings: async (...args) => { calls.push(["mutate", ...args]); },
    updateSettings: async (...args) => { calls.push(["update", ...args]); },
    installBundle: async (...args) => { calls.push(["install", ...args]); return { application: "applied", changed: true }; },
    setBundleEnabled: async (...args) => { calls.push(["enable", ...args]); return { application: "restart-required", changed: true }; },
    removeBundle: async (...args) => { calls.push(["remove", ...args]); return { application: "applied", changed: true }; },
  };
  return { rpc, settings, bundles, roster, calls, content };
}

test("native controls join current settings namespaces with the host roster and bundle inventory", async () => {
  const { rpc } = rpcFixture();
  const view = await loadSubagents(rpc, { runtime: { version: "0.2.2-alpha.3" } });
  assert.equal(view.enabled, true);
  assert.deepEqual(view.allowedModels, [{ provider: "test", model: "m" }]);
  assert.equal(view.candidates[0].selected, true);
  assert.equal(view.preset.default, "standard");
  assert.equal(view.preset.deepdeckFull, true);
  assert.equal(view.backends[0].installed, false);
});

test("model selection validates routes and sends the current revision fence", async () => {
  const { rpc, calls, settings } = rpcFixture();
  await saveSubagents(rpc, { enabled: true, allowedModels: [{ provider: "test", model: "m" }, { provider: "test", model: "m" }] });
  assert.equal(calls[0][1], SELECTION_NS);
  assert.equal(calls[0][3], 7);
  assert.deepEqual(calls[0][2][1].value, [{ provider: "test", model: "m" }]);
  await assert.rejects(() => saveSubagents(rpc, { allowedModels: [{}] }), /needs a provider/);
  settings.writable = false;
  await assert.rejects(() => saveSubagents(rpc, { allowedModels: [] }), /read-only/);
});

test("missing capabilities produce an explicit error instead of an empty successful panel", async () => {
  const { rpc, settings } = rpcFixture();
  settings.namespaces = [];
  await assert.rejects(() => loadSubagents(rpc), /required subagent/);
  await assert.rejects(() => verifyCompatibility(rpc), /Unsupported settings namespace/);
});

test("activation and compatibility come from the host, not an exact version comparison", () => {
  const name = BUNDLES.codex.package;
  const active = backendStatus("codex", [{ name, installed: true, enabled: true, version: "0.2.1" }], "0.2.2-alpha.3", [
    { moduleName: name, enabled: true, fiberPhase: "active" },
    { patchId: "tool-subagent-codex", enabled: true, fiberPhase: "active" },
  ]);
  assert.equal(active.compatible, true);
  assert.equal(active.bundleActive, true);
  const denied = backendStatus("codex", [{ name, installed: true, enabled: true, error: { code: "incompatible-version" } }], "0.2.2-alpha.3");
  assert.equal(denied.compatible, false);
  assert.equal(denied.bundleActive, false);
  assert.throws(() => backendStatus("unknown", [], "x"), /Unknown/);
});

test("backend installation uses the offered target and checks actual application outcomes", async () => {
  const { rpc, calls, bundles } = rpcFixture();
  await installBackend(rpc, "codex");
  assert.deepEqual(calls[0], ["install", bundles[0].installTarget.spec]);
  bundles[0].availability = "profile";
  await installBackend(rpc, "codex");
  assert.deepEqual(calls[1], ["enable", BUNDLES.codex.package, true]);
  await removeBackend(rpc, "codex");
  rpc.installBundle = async () => ({ application: "failed", error: { diagnostic: "activation refused" } });
  bundles[0].availability = "missing";
  await assert.rejects(() => installBackend(rpc, "codex"), /activation refused/);
});

test("preset creation registers a supported private bundle and preserves expression tags", async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-preset-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const { rpc, calls, content } = rpcFixture();
  const preset = await createDeepDeckPreset(rpc, { home });
  const file = path.join(preset.directory, "cordis.patch.yml");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /name: '@deepseek-ai\/dsh-agent-preset'/);
  assert.match(text, /id: deepdeck-full/);
  assert.match(text, /disabled: !!js process.platform/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(preset.directory, "package.json"))).name, PRESET_PACKAGE);
  assert.deepEqual(calls[0], ["install", preset.directory]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await createDeepDeckPreset(rpc, { home, automatic: true });
  fs.appendFileSync(file, "# User modification\n");
  await assert.rejects(() => createDeepDeckPreset(rpc, { home, automatic: true }), /custom edits/);
  assert.equal((await rpc.readPreset("standard")).content, content);
});

test("preset selection is validated and saved through selectedDefault with a revision fence", async () => {
  const { rpc, calls, roster } = rpcFixture();
  await setPresetDefault(rpc, "deepdeck-full");
  assert.deepEqual(calls[0], ["update", PRESET_NS, { selectedDefault: "deepdeck-full" }, 11]);
  roster.presets[1].broken = "Missing plugin";
  await assert.rejects(() => setPresetDefault(rpc, "deepdeck-full"), /Missing plugin/);
  roster.presets[1].broken = undefined;
  roster.presets[0].isDefault = false;
  roster.presets[1].isDefault = true;
  await removeDeepDeckPreset(rpc);
  assert.deepEqual(calls.at(-1), ["remove", PRESET_PACKAGE]);
});

test("promotion contract checks reject bad provider shapes, inactive defaults, and failed selected plugins", async () => {
  const { rpc, bundles, roster } = rpcFixture();
  await verifyCompatibility(rpc);
  bundles[0].enabled = true;
  bundles[0].error = { diagnostic: "plugin failed" };
  await assert.rejects(() => verifyCompatibility(rpc), /plugin failed/);
  bundles[0].enabled = false;
  roster.presets[0].broken = "preset failed";
  await assert.rejects(() => verifyCompatibility(rpc), /preset failed/);
  delete roster.presets[0].broken;
  rpc.listConfigurableProviders = async () => [{}];
  await assert.rejects(() => verifyCompatibility(rpc), /provider settings addresses/);
});

test("legacy presets are registered in the private profile; an unusable import falls back without deleting it", async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-legacy-preset-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const legacy = path.join(home, ".agent-presets", "deepdeck-full", "agent.cordis.yml");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, "- id: user-tool\n  name: '@example/legacy-tool'\n");
  const { rpc, settings, calls, roster } = rpcFixture();
  settings.namespaces.find(item => item.ns === PRESET_NS).value.selectedDefault = "deepdeck-full";
  roster.presets[1].broken = "Legacy package is unavailable";
  let restarts = 0;
  const warning = await preparePresets({ rpc: () => rpc, restart: async () => { restarts++; } }, { home }, { imported: true });
  assert.match(warning, /preserved privately/);
  assert.equal(restarts, 1);
  assert.equal(fs.readFileSync(legacy, "utf8"), "- id: user-tool\n  name: '@example/legacy-tool'\n");
  assert.deepEqual(calls.at(-1), ["update", PRESET_NS, { selectedDefault: "standard" }, 11]);
  assert.equal(fs.existsSync(path.join(home, "bundles", "deepdeck-full", "generated.json")), false);
});
