const assert = require("node:assert/strict");
const { SELECTION_NS, PRESET_NS } = require("./subagents");

/** Read-only checks against the real host, shared by promotion and CI smoke tests. */
async function verifyCompatibility(rpc) {
  const [settings, providers, directory, credentials, bundles, roster, plugins] = await Promise.all([
    rpc.describeSettings(), rpc.listProviders(), rpc.listConfigurableProviders(), rpc.describeCredentials([]),
    rpc.listBundles(), rpc.listPresets(), rpc.listPlugins(),
  ]);
  assert.ok(Array.isArray(settings?.namespaces), "Missing settings namespace inventory");
  for (const ns of ["llm-pi-ai", "agent-default-model", SELECTION_NS, PRESET_NS, "ui-theme"]) {
    const view = settings.namespaces.find(item => item.ns === ns);
    assert.ok(view && Number.isFinite(view.revision) && typeof view.value === "object", `Unsupported settings namespace: ${ns}`);
  }
  assert.ok(Array.isArray(providers) && Array.isArray(directory), "Unsupported provider inventory");
  assert.ok(directory.every(item => typeof item.settingsNs === "string" && Array.isArray(item.settingsPath)), "Unsupported provider settings addresses");
  assert.ok(credentials && typeof credentials === "object", "Unsupported credential status API");
  assert.ok(Array.isArray(bundles), "Unsupported plugin inventory");
  for (const bundle of bundles) {
    if (bundle.enabled && bundle.error) throw new Error(`Selected bundle ${bundle.name} failed: ${bundle.error.diagnostic || bundle.error.code}`);
  }
  assert.ok(Array.isArray(plugins), "Unsupported plugin activation inventory");
  for (const plugin of plugins) {
    if (plugin.enabled && plugin.fiberPhase === "failed") throw new Error(plugin.diagnostic || `Plugin ${plugin.moduleName} failed to activate`);
  }
  assert.ok(Array.isArray(roster?.presets), "Unsupported preset roster");
  const selected = roster.presets.find(item => item.isDefault);
  assert.ok(selected && !selected.broken, selected?.broken || "The default preset did not activate");
  const composition = await rpc.readPreset(selected.id);
  assert.ok(typeof composition?.content === "string" && composition.content.trim(), "The default preset has no composition");
  return { settings, providers, bundles, roster };
}
module.exports = { verifyCompatibility };
