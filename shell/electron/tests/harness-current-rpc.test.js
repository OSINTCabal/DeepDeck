const test = require("node:test");
const assert = require("node:assert/strict");
const { createRpcClient } = require("../lib/harness-rpc");

test("current plugin and preset RPCs send named arguments with authenticated unary envelopes", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.cookie, "private-cookie=value");
    assert.equal(options.headers.origin, "http://127.0.0.1:9411");
    assert.equal(body.type, "client-request");
    calls.push([url, body.method, body.payload.args]);
    return { ok: true, json: async () => ({ type: "server-response", rpcId: body.rpcId, result: { ok: true, value: [] } }) };
  });
  const rpc = createRpcClient({ origin: "http://127.0.0.1:9411", cookie: "private-cookie=value" });
  await rpc.listPlugins();
  await rpc.listBundles();
  await rpc.installBundle("@example/plugin@1.0.0");
  await rpc.setBundleEnabled("@example/plugin", true);
  await rpc.removeBundle("@example/plugin");
  await rpc.listPresets();
  await rpc.readPreset("standard");
  assert.deepEqual(calls.map(([, method, args]) => [method, args]), [
    ["pluginManager/listPlugins", {}], ["pluginManager/listBundles", {}],
    ["pluginManager/installBundle", { spec: "@example/plugin@1.0.0", options: { saveExact: true } }],
    ["pluginManager/setBundleEnabled", { name: "@example/plugin", enabled: true }],
    ["pluginManager/removeBundle", { name: "@example/plugin" }], ["agentPresets/list", {}],
    ["agentPresets/read", { agentPreset: "standard" }],
  ]);
});

test("stopping waits for in-flight settings writes and transport failures do not replay mutations", async t => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-rpc-stop-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { HarnessManager } = require("../lib/harness");
  const manager = new HarnessManager({ getPreferences: () => ({ harness: {} }), getRuntime: () => null,
    stateFile: path.join(directory, "state.json"), logger: { info() {}, line() {} } });
  manager.state = "ready";
  manager.client = {};
  let finish;
  let written = false;
  const operation = manager.withRpc(async () => { await new Promise(resolve => { finish = resolve; }); written = true; });
  await new Promise(resolve => setImmediate(resolve));
  const stopped = manager.stop();
  assert.equal(written, false);
  finish();
  await operation;
  await stopped;
  assert.equal(written, true);
  assert.equal(manager.state, "stopped");
  manager.state = "ready";
  manager.client = {};
  let mutations = 0;
  await assert.rejects(() => manager.withRpc(async () => { mutations++; throw Object.assign(new Error("transport failed"), { code: "HARNESS_UNREACHABLE" }); }), /transport failed/);
  assert.equal(mutations, 1);
});
