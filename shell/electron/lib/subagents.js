/** Native controls over the harness's own settings, plugin inventory, and preset APIs. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { HarnessRpcError } = require("./harness-rpc");
const { writeAtomic } = require("./preferences");
const { assertOwned } = require("./updates");
const SELECTION_NS = "subagent-model-selection-settings";
const PRESET_NS = "agent-preset-registry";
const PRESET_PACKAGE = "@deepdeck/preset-full";
const BUNDLES = {
  codex: {
    package: "@deepseek-ai/dsh-subagent-codex",
    label: "Codex",
    provider: "codex",
    toolId: "tool-subagent-codex",
    authHint: "Native Codex authentication (~/.codex) is authoritative.",
    order: 10,
  },
  "claude-code": {
    package: "@deepseek-ai/dsh-subagent-claude-code",
    label: "Claude Code",
    provider: "claude-code",
    toolId: "tool-subagent-claude-code",
    authHint: "Native Claude Code authentication is authoritative.",
    order: 11,
  },
};


function namespaceView(describe, ns) { return (describe.namespaces || []).find(view => view.ns === ns); }
function backendStatus(kind, bundles, runtimeVersion, plugins = []) {
  const info = BUNDLES[kind];
  if (!info) throw new HarnessRpcError(`Unknown subagent backend: ${kind}`);
  const bundle = bundles.find(item => item.name === info.package);
  const incompatible = bundle?.error?.code === "incompatible-version";
  const provider = plugins.find(item => item.moduleName === info.package);
  const toolId = bundle?.rows?.find(item => item.rowId === info.toolId)?.entryId;
  const tool = plugins.find(item => toolId ? item.entryId === toolId : item.patchId === info.toolId);
  const active = [provider, tool].every(item => item?.enabled && item.fiberPhase === "active");
  return {
    kind, label: info.label, package: info.package, provider: info.provider,
    installed: bundle?.installed === true || bundle?.availability === "installation",
    hasBundle: Boolean(bundle && !bundle.error), version: bundle?.version || null, runtimeVersion,
    compatible: !incompatible, bundleActive: bundle?.enabled === true && !bundle.error && active,
    error: bundle?.error?.diagnostic || bundle?.error?.code || provider?.diagnostic || tool?.diagnostic || null,
    nativeAuth: kind === "codex" ? fs.existsSync(path.join(os.homedir(), ".codex", "auth.json"))
      : fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json")),
    authHint: info.authHint,
  };
}
async function loadSubagents(rpc, { runtime } = {}) {
  const [describe, active, bundles, roster, plugins, directory] = await Promise.all([
    rpc.describeSettings(), rpc.listProviders(), rpc.listBundles(), rpc.listPresets(), rpc.listPlugins(), rpc.listConfigurableProviders(),
  ]);
  const runtimeVersion = runtime?.version || null;
  const view = namespaceView(describe, SELECTION_NS);
  const presetView = namespaceView(describe, PRESET_NS);
  if (!view || !presetView) throw new HarnessRpcError("This harness does not expose the required subagent and preset settings", { code: "HARNESS_INCOMPATIBLE" });
  const value = view.value || {};
  const allowed = Array.isArray(value.allowedModels) ? value.allowedModels : [];
  const candidates = [];
  const providers = active || [];
  await Promise.all(providers.map(async provider => {
    let models = [];
    try {
      if (provider.id === "deepseek-official") {
        const deep = namespaceView(describe, "llm-deepseek");
        models = (deep && deep.value && Array.isArray(deep.value.models) ? deep.value.models : [])
          .map(model => ({ id: model.id, name: model.name || model.id }));
      } else {
        const settingsNs = directory.find(item => item.provider === provider.id)?.settingsNs || "llm-pi-ai";
        const found = await rpc.discoverModels(settingsNs, { provider: provider.id }, { timeoutMs: 25000 });
        models = (found || []).map(model => ({ id: model.id, name: model.name || model.id }));
      }
    } catch { models = []; }
    for (const model of models) {
      candidates.push({
        provider: provider.id,
        providerName: provider.name || provider.id,
        model: model.id,
        modelName: model.name || model.id,
        available: true,
        selected: allowed.some(route => route.provider === provider.id && route.model === model.id),
      });
    }
  }));
  candidates.sort((a, b) => a.providerName.localeCompare(b.providerName) || a.modelName.localeCompare(b.modelName));
  return {
    writable: describe.writable === true,
    enabled: value.enabled === true,
    allowedModels: allowed,
    candidates,
    revisions: { [SELECTION_NS]: view ? view.revision : null },
    builtIn: [
      {
        provider: "spawn",
        label: "Spawn (in-process)",
        mode: "continuable",
        detail: "Fresh child agent with model selection; the default delegation backend.",
      },
      {
        provider: "fork",
        label: "Fork (in-process)",
        mode: "continuable",
        detail: "Child inherits the parent conversation prefix for cache reuse.",
      },
    ],
    preset: {
      default: roster.presets.find(item => item.isDefault)?.id || null,
      deepdeckFull: roster.presets.some(item => item.id === "deepdeck-full"),
      broken: roster.presets.find(item => item.id === "deepdeck-full")?.broken || null,
      revision: presetView ? presetView.revision : null,
    },
    backends: Object.keys(BUNDLES).map(kind => backendStatus(kind, bundles, runtimeVersion, plugins)),
  };
}

async function saveSubagents(rpc, { enabled, allowedModels, runtime }) {
  const describe = await rpc.describeSettings();
  if (describe.writable !== true) throw new HarnessRpcError("The harness settings document is read-only");
  const views = describe.namespaces || [];
  const view = views.find(entry => entry.ns === SELECTION_NS);
  if (!view) throw new HarnessRpcError("The harness does not expose subagent model selection");
  const routes = Array.isArray(allowedModels) ? allowedModels : [];
  const seen = new Set();
  const clean = [];
  for (const route of routes) {
    if (!route || typeof route.provider !== "string" || typeof route.model !== "string") {
      throw new HarnessRpcError("Each allowed subagent model needs a provider and model");
    }
    const key = `${route.provider}\u0000${route.model}`;
    if (!route.provider || !route.model || seen.has(key)) continue;
    seen.add(key);
    clean.push({ provider: route.provider, model: route.model });
  }
  if (enabled === true && clean.length === 0) {
    throw new HarnessRpcError("Enable at least one allowed model before turning on subagent model selection");
  }
  await rpc.mutateSettings(SELECTION_NS, [
    { op: "set", path: ["enabled"], value: enabled === true },
    { op: "set", path: ["allowedModels"], value: clean },
  ], view.revision);
  return loadSubagents(rpc, { runtime });
}

/** Remove the `disabled: true` line under one optional tool row. */

function checkChange(result) {
  if (!result || result.error || !["applied", "restart-required"].includes(result.application)) {
    throw new HarnessRpcError(result?.error?.diagnostic || result?.packageResult?.output || result?.error?.code
      || `Harness plugin change was ${result?.application || "not confirmed"}`);
  }
  return result;
}
async function installBackend(rpc, kind) {
  const info = BUNDLES[kind];
  if (!info) throw new HarnessRpcError(`Unknown subagent backend: ${kind}`);
  const bundle = (await rpc.listBundles()).find(item => item.name === info.package);
  if (!bundle) throw new HarnessRpcError("This harness does not offer that backend");
  if (bundle.error || bundle.availability === "missing") {
    if (!bundle.installTarget?.spec) throw new HarnessRpcError("No compatible backend package is offered by this harness");
    return checkChange(await rpc.installBundle(bundle.installTarget.spec));
  }
  return checkChange(await rpc.setBundleEnabled(info.package, true));
}
async function removeBackend(rpc, kind) {
  const info = BUNDLES[kind];
  if (!info) throw new HarnessRpcError(`Unknown subagent backend: ${kind}`);
  const bundle = (await rpc.listBundles()).find(item => item.name === info.package);
  return checkChange(bundle?.availability === "installation" ? await rpc.setBundleEnabled(info.package, false) : await rpc.removeBundle(info.package));
}
function hash(content) { return createHash("sha256").update(content).digest("hex"); }
function presetDirectory(home) { return path.join(home, "bundles", "deepdeck-full"); }

async function createDeepDeckPreset(rpc, { home, automatic = false, content = null } = {}) {
  if (!home) throw new HarnessRpcError("A private harness home is required");
  const directory = presetDirectory(home);
  const file = path.join(directory, "cordis.patch.yml");
  const marker = path.join(directory, "generated.json");
  for (const target of [directory, file, marker, path.join(directory, "package.json")]) assertOwned(home, target);
  if (automatic && fs.existsSync(file)) {
    if (!fs.existsSync(marker)) return null; // Imported custom declarations remain user-owned.
    const generated = JSON.parse(fs.readFileSync(marker, "utf8"));
    const current = await rpc.readPreset("deepdeck-full");
    if (hash(fs.readFileSync(file, "utf8")) !== generated.patchHash || hash(current.content) !== generated.contentHash) {
      throw new HarnessRpcError("DeepDeck Full has custom edits. Review its private bundle before updating; the working runtime is unchanged.");
    }
  }
  const standard = content === null ? await rpc.readPreset("standard") : { content };
  if (typeof standard.content !== "string" || !standard.content.trim()) throw new HarnessRpcError("The harness returned an empty preset composition");
  const text = ["- insert:", "    - id: preset-deepdeck-full", "      name: '@deepseek-ai/dsh-agent-preset'", "      config:",
    "        id: deepdeck-full", "        name: DeepDeck Full", "        description: DeepDeck coding preset", "        order: 90", "        plugins:",
    ...standard.content.trimEnd().split("\n").map(line => `          ${line}`), ""].join("\n");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!automatic && fs.existsSync(file)) fs.copyFileSync(file, path.join(directory, `previous-${Date.now()}.yml`));
  fs.writeFileSync(file, text, { mode: 0o600 });
  writeAtomic(path.join(directory, "package.json"), { name: PRESET_PACKAGE, version: `1.0.${Date.now()}`, private: true,
    type: "module", dsh: { bundle: { patch: "./cordis.patch.yml" } } });
  if (content === null) writeAtomic(marker, { patchHash: hash(text), contentHash: hash(standard.content) });
  return { directory, change: checkChange(await rpc.installBundle(directory)) };
}
async function setPresetDefault(rpc, presetId) {
  const roster = await rpc.listPresets();
  const preset = roster.presets.find(item => item.id === presetId);
  if (!preset || preset.broken) throw new HarnessRpcError(preset?.broken || "The requested preset did not activate");
  const view = namespaceView(await rpc.describeSettings(), PRESET_NS);
  if (!view) throw new HarnessRpcError("The harness does not expose preset selection");
  await rpc.updateSettings(PRESET_NS, { selectedDefault: presetId }, view.revision);
}
async function removeDeepDeckPreset(rpc) {
  const roster = await rpc.listPresets();
  if (roster.presets.some(item => item.id === "deepdeck-full" && item.isDefault)) await setPresetDefault(rpc, "standard");
  return checkChange(await rpc.removeBundle(PRESET_PACKAGE));
}
async function preparePresets(probe, runtime, { imported = false } = {}) {
  let rpc = probe.rpc();
  const generated = path.join(presetDirectory(runtime.home), "generated.json");
  const legacy = path.join(runtime.home, ".agent-presets", "deepdeck-full", "agent.cordis.yml");
  if (fs.existsSync(generated)) {
    await createDeepDeckPreset(rpc, { home: runtime.home, automatic: true });
    await probe.restart();
  } else if (imported && fs.existsSync(legacy)) {
    try {
      await createDeepDeckPreset(rpc, { home: runtime.home, content: fs.readFileSync(legacy, "utf8") });
      await probe.restart();
      rpc = probe.rpc();
      const view = namespaceView(await rpc.describeSettings(), PRESET_NS);
      if (view?.value?.selectedDefault === "deepdeck-full") await setPresetDefault(rpc, "deepdeck-full");
    } catch {
      // First import has no private last-good version. Keep its declaration and offer Standard.
      await setPresetDefault(probe.rpc(), "standard");
      return "The legacy DeepDeck Full preset was preserved privately but needs review. Standard is selected; use Subagents to compose a current preset.";
    }
  }
  return null;
}
module.exports = { BUNDLES, SELECTION_NS, PRESET_NS, PRESET_PACKAGE, loadSubagents, saveSubagents, backendStatus,
  installBackend, removeBackend, createDeepDeckPreset, setPresetDefault, removeDeepDeckPreset, checkChange, presetDirectory, preparePresets };
