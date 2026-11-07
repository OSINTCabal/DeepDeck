const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ensureProviderDefaults, DEFAULTS, OPENCODE_GO_LEGACY_BASE_URL, OPENCODE_GO_LEGACY_MODELS,
} = require("../lib/provider-defaults");

function fakeRpc(providers) {
  const calls = [];
  return {
    calls,
    async describeSettings() {
      return {
        writable: true,
        namespaces: [{ ns: "llm-pi-ai", revision: 7, value: { providers } }],
      };
    },
    async mutateSettings(ns, ops, revision) {
      calls.push({ ns, ops, revision });
    },
  };
}

test("provider defaults add only missing routes", async () => {
  const rpc = fakeRpc({ zai: { apiKeyEnv: "ZAI_API_KEY" } });
  const added = await ensureProviderDefaults(rpc);
  assert.deepEqual(added.sort(), ["minimax", "mistral", "opencode-go"]);
  assert.equal(rpc.calls.length, 1);
  assert.equal(rpc.calls[0].ns, "llm-pi-ai");
  assert.equal(rpc.calls[0].revision, 7);
  const entry = rpc.calls[0].ops.find(op => op.path[1] === "opencode-go");
  // The installed pi-ai catalog owns the OpenCode Go protocols, base URLs, and
  // model list. A route-level override corrupts mixed-protocol models.
  assert.deepEqual(entry.value, { displayName: "OpenCode Go", apiKeyEnv: "OPENCODE_API_KEY" });
});

test("provider defaults migrate the legacy forced OpenCode Go route", async () => {
  const rpc = fakeRpc({
    zai: { apiKeyEnv: "ZAI_API_KEY" },
    mistral: { apiKeyEnv: "MISTRAL_API_KEY" },
    minimax: { apiKeyEnv: "MINIMAX_API_KEY" },
    "opencode-go": {
      apiKeyEnv: "OPENCODE_API_KEY",
      baseURL: OPENCODE_GO_LEGACY_BASE_URL,
      api: "openai-completions",
      models: [...OPENCODE_GO_LEGACY_MODELS].map(id => ({ id })),
      displayName: "OpenCode Go",
      headers: { "x-user-header": "keep" },
      timeoutMs: 1234,
    },
  });
  assert.deepEqual(await ensureProviderDefaults(rpc), ["opencode-go"]);
  assert.equal(rpc.calls.length, 1);
  const ops = rpc.calls[0].ops;
  assert.deepEqual(ops, [
    { op: "unset", path: ["providers", "opencode-go", "api"] },
    { op: "unset", path: ["providers", "opencode-go", "baseURL"] },
    { op: "unset", path: ["providers", "opencode-go", "models"] },
  ]);
  // No whole-profile set: custom headers/timeouts stay untouched.
  assert.equal(ops.some(op => op.op === "set"), false);
});

test("provider defaults do not migrate a same-base customized route", async () => {
  const rpc = fakeRpc({
    zai: {}, mistral: {}, minimax: {},
    "opencode-go": {
      apiKeyEnv: "MY_GO",
      baseURL: OPENCODE_GO_LEGACY_BASE_URL,
      api: "openai-completions",
      models: [{ id: "my-custom-model" }],
      headers: { "x-user-header": "keep" },
    },
  });
  assert.deepEqual(await ensureProviderDefaults(rpc), []);
  assert.equal(rpc.calls.length, 0);
});

test("provider defaults leave a user-customized OpenCode Go route alone", async () => {
  const rpc = fakeRpc({
    zai: {}, mistral: {}, minimax: {},
    "opencode-go": {
      apiKeyEnv: "MY_GO",
      baseURL: "https://example.test/v1",
      api: "openai-completions",
      models: [{ id: "x" }],
    },
  });
  assert.deepEqual(await ensureProviderDefaults(rpc), []);
  assert.equal(rpc.calls.length, 0);
});

test("provider defaults stay quiet on a read-only settings document", async () => {
  const rpc = fakeRpc({});
  rpc.describeSettings = async () => ({ writable: false, namespaces: [{ ns: "llm-pi-ai", revision: 1, value: { providers: {} } }] });
  assert.deepEqual(await ensureProviderDefaults(rpc), []);
});

test("default routes use the expected env references", () => {
  const byId = Object.fromEntries(DEFAULTS.map(entry => [entry.id, entry.profile]));
  assert.equal(byId.mistral.apiKeyEnv, "MISTRAL_API_KEY");
  assert.equal(byId.minimax.apiKeyEnv, "MINIMAX_API_KEY");
  assert.equal(byId.zai.apiKeyEnv, "ZAI_API_KEY");
  assert.deepEqual(byId["opencode-go"], { displayName: "OpenCode Go", apiKeyEnv: "OPENCODE_API_KEY" });
});

test("provider seeding makes a deliberate deletion sticky", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-provider-seed-"));
  const seedFile = path.join(dir, "provider-defaults.json");
  try {
    const first = fakeRpc({
      zai: { apiKeyEnv: "ZAI_API_KEY" },
      mistral: { apiKeyEnv: "MISTRAL_API_KEY" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY" },
    });
    assert.deepEqual(await ensureProviderDefaults(first, { seedFile }), ["opencode-go"]);
    const seeded = JSON.parse(fs.readFileSync(seedFile, "utf8"));
    assert.deepEqual(seeded.sort(), ["minimax", "mistral", "opencode-go", "zai"]);

    // The user removed Mistral after the first seed. It must not come back.
    const second = fakeRpc({
      zai: { apiKeyEnv: "ZAI_API_KEY" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY" },
      "opencode-go": { apiKeyEnv: "OPENCODE_API_KEY" },
    });
    assert.deepEqual(await ensureProviderDefaults(second, { seedFile }), []);
    assert.equal(second.calls.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a seeded legacy route is still migrated", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-provider-legacy-seed-"));
  const seedFile = path.join(dir, "provider-defaults.json");
  try {
    fs.writeFileSync(seedFile, JSON.stringify(["zai", "mistral", "minimax", "opencode-go"]));
    const rpc = fakeRpc({
      zai: {}, mistral: {}, minimax: {},
      "opencode-go": {
        apiKeyEnv: "OPENCODE_API_KEY",
        baseURL: OPENCODE_GO_LEGACY_BASE_URL,
        api: "openai-completions",
        models: [...OPENCODE_GO_LEGACY_MODELS].map(id => ({ id })),
      },
    });
    assert.deepEqual(await ensureProviderDefaults(rpc, { seedFile }), ["opencode-go"]);
    assert.equal(rpc.calls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
