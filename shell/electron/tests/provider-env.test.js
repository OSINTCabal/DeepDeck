const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { providerEnv } = require("../lib/provider-env");

function fixture(auth) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-provider-env-"));
  fs.mkdirSync(path.join(root, "opencode"), { recursive: true });
  fs.writeFileSync(path.join(root, "opencode", "auth.json"), JSON.stringify(auth));
  return root;
}

test("providerEnv maps the existing OpenCode keys to harness env names", () => {
  const root = fixture({
    mistral: { type: "api", key: "mistral-key-value" },
    zai: { type: "api", key: "zai-key-value" },
    minimax: { type: "api", key: "minimax-key-value" },
    "opencode-go": { type: "api", key: "opencode-go-key-value" },
    deepseek: { type: "api", key: "not-exported" },
  });
  try {
    const env = providerEnv({ dataHome: root, env: {} });
    assert.deepEqual(env, {
      MISTRAL_API_KEY: "mistral-key-value",
      ZAI_API_KEY: "zai-key-value",
      Z_AI_API_KEY: "zai-key-value",
      MINIMAX_API_KEY: "minimax-key-value",
      OPENCODE_API_KEY: "opencode-go-key-value",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("providerEnv respects an explicit environment override", () => {
  const root = fixture({
    mistral: { type: "api", key: "mistral-file" },
    zai: { type: "api", key: "zai-file" },
  });
  try {
    const env = providerEnv({ dataHome: root, env: { MISTRAL_API_KEY: "mistral-shell" } });
    assert.equal(env.MISTRAL_API_KEY, undefined);
    assert.equal(env.ZAI_API_KEY, "zai-file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("providerEnv is empty when OpenCode has no auth file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-provider-env-"));
  try {
    assert.deepEqual(providerEnv({ dataHome: root, env: {} }), {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
