const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { RuntimeManager, BASE_RELEASE, latestRelease, migrateEntries, copyPrivate } = require("../lib/updates");
const { runtimeEnvironment, nodeSupported, resolveInvocation } = require("../lib/harness");

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-private-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "official-home");
  const agents = path.join(directory, "official-agents");
  for (const name of ["profiles/web/node_modules", "profiles/desktop", "sessions", "attachments", "cache"]) fs.mkdirSync(path.join(source, name), { recursive: true });
  fs.mkdirSync(agents);
  fs.writeFileSync(path.join(source, ".credentials.yaml"), "TEST_KEY: dummy-secret\n");
  fs.writeFileSync(path.join(source, "sessions", "existing.jsonl"), '{"saved":true}\n');
  fs.writeFileSync(path.join(source, "attachments", "report.log"), "keep this attachment\n");
  fs.writeFileSync(path.join(source, "profiles", "web", "package.json"), JSON.stringify({ private: true, dependencies: {} }));
  fs.writeFileSync(path.join(source, "profiles", "desktop", "lock"), "official-desktop-sentinel");
  fs.writeFileSync(path.join(source, "cache", "sentinel"), "do not copy");
  fs.writeFileSync(path.join(agents, "AGENTS.md"), "User instructions\n");
  const original = snapshot(source);
  const manager = new RuntimeManager({ root: path.join(directory, "deepdeck", "harness"), sourceHome: source, sourceAgentsHome: agents,
    nodeResolver: () => process.execPath,
    installer: async slot => {
      const bin = path.join(slot.dir, "node_modules", "@deepseek-ai", "dsh", "lib");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, "bin.js"), "// test package\n");
    }, migrate: async () => {}, ...options });
  manager.save({ pending: BASE_RELEASE });
  return { manager, source, agents, original, directory };
}
function snapshot(root) {
  const result = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const stat = fs.lstatSync(file);
        result[path.relative(root, file)] = { ino: stat.ino, mtime: stat.mtimeMs, mode: stat.mode,
          hash: createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
      }
    }
  }
  walk(root);
  return result;
}
const good = { validate: async () => {} };
function nextRelease(version = "0.2.2-alpha.4") { return { ...BASE_RELEASE, version, tag: `dsh-v${version}` }; }

test("installation imports private copies and leaves the official installation unchanged", async t => {
  const { manager, source, original, agents } = fixture(t);
  let checked;
  await manager.update({ validate: async slot => {
    checked = slot;
    assert.equal(fs.readFileSync(path.join(slot.home, "sessions/existing.jsonl"), "utf8"), '{"saved":true}\n');
    assert.equal(fs.existsSync(path.join(slot.home, "profiles/desktop")), false);
    assert.equal(fs.existsSync(path.join(slot.home, "profiles/web/node_modules")), false);
    assert.equal(fs.existsSync(path.join(slot.home, "cache")), false);
    assert.equal(fs.readFileSync(path.join(slot.home, "attachments/report.log"), "utf8"), "keep this attachment\n");
    assert.equal(fs.statSync(path.join(slot.home, ".credentials.yaml")).mode & 0o777, 0o600);
    const env = runtimeEnvironment(slot, { PATH: "/usr/bin", DSH_HOME: source, DSH_AGENTS_HOME: agents });
    assert.equal(env.DSH_HOME, slot.home);
    assert.equal(env.DSH_AGENTS_HOME, slot.agentsHome);
    fs.appendFileSync(path.join(slot.home, "sessions/existing.jsonl"), '{"private":true}\n');
  } });
  assert.equal(manager.current().id, checked.id);
  assert.deepEqual(snapshot(source), original);
  assert.equal(fs.readFileSync(path.join(agents, "AGENTS.md"), "utf8"), "User instructions\n");
  assert.equal(fs.statSync(manager.file).mode & 0o777, 0o600);
  assert.deepEqual(resolveInvocation({ runtime: manager.current(), workdir: "/tmp" }).args,
    [path.join(checked.dir, "node_modules/@deepseek-ai/dsh/lib/bin.js")]);
});

test("background checks do not promote; the next launch verifies a separate data copy", async t => {
  const { manager } = fixture(t);
  await manager.update(good);
  const first = manager.current();
  fs.writeFileSync(path.join(first.home, "new-session.json"), "private live session");
  manager.fetcher = async url => ({ ok: true, json: async () => url.includes("api.github")
    ? [{ tag_name: "dsh-v0.2.2-alpha.4", published_at: "2026-11-04", draft: false }]
    : { version: "0.2.2-alpha.4", engines: { node: ">=24.9.0" }, packageManager: "pnpm@11.28.5" } });
  await manager.check();
  assert.equal(manager.current().id, first.id);
  assert.equal(manager.status().state, "pending");
  await manager.prepare({ autoUpdate: false, ...good });
  assert.equal(manager.current().id, first.id);
  await manager.prepare({ autoUpdate: true, validate: async slot => {
    assert.notEqual(slot.home, first.home);
    assert.equal(fs.readFileSync(path.join(slot.home, "new-session.json"), "utf8"), "private live session");
    fs.writeFileSync(path.join(slot.home, "new-session.json"), "migrated candidate");
  } });
  assert.equal(manager.current().version, "0.2.2-alpha.4");
  assert.equal(manager.state.previous, first.id);
  assert.equal(fs.readFileSync(path.join(first.home, "new-session.json"), "utf8"), "private live session");
});

for (const phase of ["Node prerequisite", "package install", "plugin migration", "host RPC", "Code page boot"]) {
  test(`${phase} failure preserves runtime and data; failed candidates do not loop on launch`, async t => {
    const { manager, source, original } = fixture(t);
    await manager.update(good);
    const first = manager.current();
    const working = snapshot(first.home);
    manager.save({ pending: nextRelease() });
    const fail = async slot => { if (slot) fs.writeFileSync(path.join(slot.home, "candidate-only"), "partial migration"); throw new Error(phase); };
    if (phase === "Node prerequisite") manager.nodeResolver = () => { throw new Error(phase); };
    if (phase === "package install") manager.installer = fail;
    if (phase === "plugin migration") manager.migrate = fail;
    await assert.rejects(() => manager.update({ validate: fail }), new RegExp(phase));
    assert.equal(manager.current().id, first.id);
    assert.deepEqual(snapshot(first.home), working);
    assert.deepEqual(snapshot(source), original);
    assert.equal(manager.status().failedVersion, "0.2.2-alpha.4");
    manager.nodeResolver = () => process.execPath;
    await manager.prepare({ validate: () => { throw new Error("must not retry automatically"); } });
    assert.equal(manager.current().id, first.id);
  });
}

test("an interrupted candidate never becomes active and an explicit retry can recover", async t => {
  const { manager } = fixture(t);
  await manager.update(good);
  const first = manager.current().id;
  manager.save({ pending: nextRelease(), attempt: { id: "unused-candidate", version: "0.2.2-alpha.4" } });
  await manager.prepare(good);
  assert.equal(manager.current().id, first);
  assert.match(manager.status().error, /interrupted/);
  await manager.update(good);
  assert.equal(manager.current().version, "0.2.2-alpha.4");
});

test("cancellation and concurrent updates cannot promote a partial candidate", async t => {
  let release;
  const { manager } = fixture(t, { installer: async () => new Promise(resolve => { release = resolve; }) });
  const operation = manager.update(good);
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => manager.update(good), /already in progress/);
  const closing = manager.close();
  release();
  await assert.rejects(operation, /abort/i);
  await closing;
  assert.equal(manager.current(), null);
});

test("promotion requires validation; malformed state and links cannot redirect updates", async t => {
  const { manager, source, directory } = fixture(t);
  await assert.rejects(() => manager.update({}), /validation is required/);
  const link = path.join(directory, "linked-home");
  fs.symlinkSync(source, link);
  assert.throws(() => copyPrivate(link, path.join(directory, "copy")), /symbolic link/);
  assert.throws(() => new RuntimeManager({ root: link, sourceHome: source }), /separate/);
  manager.save({ active: "../official-home" });
  assert.throws(() => manager.current(), /identifier/);
});

test("release discovery includes prereleases, ignores drafts, and validates version/toolchain metadata", async () => {
  const fetcher = async url => ({ ok: true, json: async () => url.includes("api.github") ? [
    { tag_name: "dsh-v9.0.0", draft: true, published_at: "today" },
    { tag_name: "desktop-v99", draft: false, published_at: "today" },
    { tag_name: "dsh-v0.2.2-alpha.3", draft: false, published_at: "today" },
    { tag_name: "dsh-v0.2.1", draft: false, published_at: "today" },
  ] : { version: "0.2.2-alpha.3", engines: { node: ">=24.9.0" }, packageManager: "pnpm@11.28.5" } });
  assert.deepEqual(await latestRelease(fetcher), BASE_RELEASE);
  await assert.rejects(() => latestRelease(async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(() => latestRelease(async () => ({ ok: true, json: async () => [] })), /No published/);
  assert.equal(nodeSupported("v22.22.3"), false);
  assert.equal(nodeSupported("24.8.9"), false);
  assert.equal(nodeSupported("24.9.0"), true);
  assert.equal(nodeSupported("v24.16.0"), true);
});

test("settings migration uses current entry IDs and preserves unrelated configuration", () => {
  const value = [{ id: "agent-presets", config: { default: "deepdeck-full", modeSelectionEnabled: true } },
    { id: "subagent-model-selection", config: { enabled: true, allowedModels: [{ provider: "test", model: "m" }] } },
    { id: "llm-pi-ai", config: { providers: { custom: { apiKeyEnv: "TEST_KEY" } } } }];
  const migrated = migrateEntries(structuredClone(value));
  assert.deepEqual(migrated[0], { id: "agent-preset-registry", config: { selectedDefault: "deepdeck-full" } });
  assert.equal(migrated[1].id, "subagent-model-selection-settings");
  assert.deepEqual(migrated[2], value[2]);
  assert.deepEqual(migrateEntries(migrated), migrated);
  assert.throws(() => migrateEntries({}), /must be a list/);
});

test("a symlink in a parent cannot redirect a new private home into official data", t => {
  const { directory, source } = fixture(t);
  const parent = path.join(directory, "redirected");
  fs.symlinkSync(source, parent);
  assert.throws(() => new RuntimeManager({ root: path.join(parent, "new-deepdeck"), sourceHome: source }), /separate/);
  assert.equal(fs.existsSync(path.join(source, "new-deepdeck")), false);
});

test("a post-promotion startup failure restores the previous runtime and its complete data", async t => {
  const { manager } = fixture(t);
  await manager.update(good);
  const first = manager.current();
  const saved = snapshot(first.home);
  manager.save({ pending: nextRelease() });
  await manager.update(good);
  manager.rollbackBoot(first.id, "second process failed to start");
  assert.equal(manager.current().id, first.id);
  assert.deepEqual(snapshot(first.home), saved);
  assert.equal(manager.status().failedVersion, "0.2.2-alpha.4");
  assert.equal(manager.status().pendingVersion, "0.2.2-alpha.4");
});
