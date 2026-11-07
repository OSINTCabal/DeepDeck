const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveRef, refFor, presetFor, readPath, normalizeBaseURL, normalizeModels,
  loadProviders, saveProvider, setDefaultModel, revisionOf,
} = require("../lib/providers");

function fakeRpc({ describe, directory, active, credentials, discovered }) {
  const calls = { mutate: [], update: [], setCredential: [], unset: [] };
  return {
    calls,
    describeSettings: async () => describe,
    listConfigurableProviders: async () => directory,
    listProviders: async () => active,
    describeCredentials: async refs => credentials(refs),
    discoverModels: async (_ns, request) => (discovered ? discovered(request) : []),
    mutateSettings: async (ns, ops, revision) => { calls.mutate.push({ ns, ops, revision }); return {}; },
    updateSettings: async (ns, patch, revision) => { calls.update.push({ ns, patch, revision }); return {}; },
    setCredential: async (ref, value) => { calls.setCredential.push({ ref, value }); },
    unsetCredential: async ref => { calls.unset.push({ ref }); },
  };
}

const describe = {
  writable: true,
  namespaces: [
    {
      ns: "llm-deepseek",
      revision: 5,
      value: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        models: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }],
      },
    },
    {
      ns: "llm-pi-ai",
      revision: 7,
      value: { providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } },
    },
    {
      ns: "agent-default-model",
      revision: 3,
      value: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max" },
    },
  ],
};

const directory = [
  { provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: [] },
  { provider: "openai", displayName: "OpenAI", settingsNs: "llm-pi-ai", settingsPath: ["providers", "openai"] },
  { provider: "anthropic", displayName: "Anthropic", settingsNs: "llm-pi-ai", settingsPath: ["providers", "anthropic"] },
];

function rpc() {
  return fakeRpc({
    describe,
    directory,
    active: [{ id: "deepseek-official", name: "DeepSeek" }, { id: "openai", name: "OpenAI" }],
    credentials: refs => Object.fromEntries(refs.map(ref => [ref, {
      configured: ref === "DEEPSEEK_API_KEY",
      source: ref === "DEEPSEEK_API_KEY" ? "file" : undefined,
      writable: ref !== "ANTHROPIC_API_KEY",
    }])),
    discovered: request => (request.provider === "openai" ? [{ id: "gpt-4.1", name: "GPT-4.1" }] : []),
  });
}

test("derives credential references and keeps preset conventions", () => {
  assert.equal(deriveRef("my-gateway"), "MY_GATEWAY_API_KEY");
  assert.equal(refFor("deepseek-official", presetFor("deepseek-official")), "DEEPSEEK_API_KEY");
  assert.equal(refFor("openai", presetFor("openai")), "OPENAI_API_KEY");
  assert.equal(refFor("no-preset", null), "NO_PRESET_API_KEY");
});

test("loads the provider directory with active and credential state", async () => {
  const client = rpc();
  const view = await loadProviders(client);
  assert.equal(view.writable, true);
  assert.equal(view.providers.length, 4); // directory + synthetic Ollama
  const deepseek = view.providers.find(provider => provider.provider === "deepseek-official");
  assert.equal(deepseek.active, true);
  assert.equal(deepseek.key.configured, true);
  assert.deepEqual(deepseek.models.map(model => model.id), ["deepseek-flash", "deepseek-v4-pro"]);
  const openai = view.providers.find(provider => provider.provider === "openai");
  assert.equal(openai.configured, true);
  assert.equal(openai.models[0].id, "gpt-4.1");
  const anthropic = view.providers.find(provider => provider.provider === "anthropic");
  assert.equal(anthropic.configured, false);
  assert.equal(anthropic.key.writable, false);
  const ollama = view.providers.find(provider => provider.provider === "ollama");
  assert.equal(ollama.custom, true);
  assert.equal(view.defaultModel.model, "deepseek-flash");
  assert.equal(view.revisions["llm-pi-ai"], 7);
});

test("saves a catalog provider profile and writes its key", async () => {
  const client = rpc();
  const view = await saveProvider(client, { provider: "anthropic", key: "sk-ant-test" });
  assert.equal(view.providers.length, 4);
  const mutation = client.calls.mutate.at(-1);
  assert.equal(mutation.ns, "llm-pi-ai");
  assert.equal(mutation.revision, 7);
  assert.deepEqual(mutation.ops[0], {
    op: "set",
    path: ["providers", "anthropic"],
    value: { apiKeyEnv: "ANTHROPIC_API_KEY" },
  });
  assert.deepEqual(client.calls.setCredential.at(-1), { ref: "ANTHROPIC_API_KEY", value: "sk-ant-test" });
});

test("declares a custom route with protocol and models", async () => {
  const client = rpc();
  await saveProvider(client, {
    provider: "gateway",
    custom: true,
    baseURL: "https://gateway.example/v1/",
    api: "openai-completions",
    key: "gw-test",
    models: ["one", "two", "one"],
  });
  const mutation = client.calls.mutate.at(-1);
  assert.equal(mutation.ops[0].value.baseURL, "https://gateway.example/v1");
  assert.deepEqual(mutation.ops[0].value.models, [{ id: "one" }, { id: "two" }]);
  assert.deepEqual(client.calls.setCredential.at(-1), { ref: "GATEWAY_API_KEY", value: "gw-test" });
});

test("rejects unsafe base URLs and empty custom catalogs", async () => {
  const client = rpc();
  await assert.rejects(() => saveProvider(client, { provider: "gateway", custom: true, baseURL: "file:///etc", api: "openai-completions", models: ["x"] }), /HTTP or HTTPS/);
  await assert.rejects(() => saveProvider(client, { provider: "gateway", custom: true, baseURL: "https://gateway.example", api: "openai-completions", models: [] }), /at least one model/);
  await assert.rejects(() => saveProvider(client, { provider: "Bad ID", custom: true }), /lowercase/);
  assert.equal(normalizeBaseURL("https://x.example/v1/"), "https://x.example/v1");
  assert.deepEqual(normalizeModels(["a", "b", "a"]), [{ id: "a" }, { id: "b" }]);
});

test("sets the default model and clears an unselected effort", async () => {
  const client = rpc();
  await setDefaultModel(client, { provider: "openai", model: "gpt-4.1", reasoningEffort: null });
  const mutation = client.calls.mutate.at(-1);
  assert.equal(mutation.ns, "agent-default-model");
  assert.equal(mutation.revision, 3);
  assert.deepEqual(mutation.ops, [
    { op: "set", path: ["provider"], value: "openai" },
    { op: "set", path: ["model"], value: "gpt-4.1" },
    { op: "unset", path: ["reasoningEffort"] },
  ]);
});

test("readPath and revisionOf are strict", () => {
  assert.equal(readPath({ providers: { a: { b: 1 } } }, ["providers", "a", "b"]), 1);
  assert.equal(readPath({}, ["missing"]), undefined);
  assert.equal(revisionOf(describe, "llm-pi-ai"), 7);
  assert.throws(() => revisionOf(describe, "nope"), /no settings namespace/);
});
