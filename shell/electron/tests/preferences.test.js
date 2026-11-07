const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defaults, normalize, createStore } = require("../lib/preferences");

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepdeck-prefs-")), "config.json");
}

test("defaults use a generic workspace and private runtime, with next-launch updates", () => {
  const home = process.env.HOME || os.homedir();
  const value = defaults();
  assert.equal(value.harness.workdir, process.env.DEEPDECK_WORKDIR || path.join(home, "Documents", "DeepDeck"));
  assert.equal(value.harness.repo, undefined);
  assert.equal(value.harness.patch, undefined);
  assert.equal(value.updates.autoCheck, true);
  assert.equal(value.updates.autoUpdate, true);
  assert.equal(value.harness.port, 9411);
  assert.equal(value.mode, "chat");
  assert.equal(value.firstRun, true);
});

test("normalize rejects invalid modes, themes, zoom, and ports", () => {
  const value = normalize({
    mode: "hack",
    theme: "neon",
    zoom: 9,
    harness: { port: 7, repo: "", workdir: "", mode: "wat" },
    updates: { autoCheck: "yes", autoUpdate: 1 },
    window: { width: 1, height: 1 },
  });
  assert.equal(value.mode, "chat");
  assert.equal(value.theme, "system");
  assert.equal(value.zoom, 1);
  assert.equal(value.harness.port, 9411);
  assert.equal(value.harness.repo, defaults().harness.repo);
  assert.equal(value.harness.mode, undefined);
  assert.equal(value.updates.autoCheck, true);
  assert.equal(value.updates.autoUpdate, true);
  assert.equal(value.window.width, 960);
  assert.equal(value.window.height, 600);
});

test("normalize preserves the extended shell themes", () => {
  for (const theme of ["light", "dark", "midnight", "graphite", "paper"]) {
    assert.equal(normalize({ theme }).theme, theme);
  }
});

test("normalize stores a chat folder grant but rejects an empty path", () => {
  assert.equal(normalize({ web: { chatDirectory: "/tmp/project" } }).web.chatDirectory, "/tmp/project");
  assert.equal(normalize({ web: { chatDirectory: "   " } }).web.chatDirectory, null);
  assert.equal(normalize({ web: { chatDirectory: 7 } }).web.chatDirectory, null);
});

test("store persists a normalized document with owner-only permissions", () => {
  const file = tempFile();
  const store = createStore(file);
  const next = store.patch({ theme: "dark", zoom: 1.25, harness: { workdir: "/tmp/project" } });
  assert.equal(next.theme, "dark");
  assert.equal(next.zoom, 1.25);
  assert.equal(next.harness.workdir, "/tmp/project");
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(onDisk.theme, "dark");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const reloaded = createStore(file).get();
  assert.equal(reloaded.harness.workdir, "/tmp/project");
  assert.equal(reloaded.firstRun, true);
});

test("invalid stored values fall back to defaults", () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({ mode: "nope", zoom: 2, harness: { port: "abc" } }));
  const value = createStore(file).get();
  assert.equal(value.mode, "chat");
  assert.equal(value.zoom, 1);
  assert.equal(value.harness.port, 9411);
});

test("legacy checkout overrides are discarded and v1 preferences migrate to next-launch updates", () => {
  const value = normalize({ version: 1, harness: { repo: "/official/source", mode: "source", patch: "/official/patch.yml" }, updates: { autoUpdate: false } });
  assert.equal(value.version, 2);
  assert.equal(value.updates.autoUpdate, true);
  assert.equal(value.harness.repo, undefined);
  assert.equal(value.harness.patch, undefined);
  assert.equal(normalize({ version: 2, updates: { autoUpdate: false } }).updates.autoUpdate, false);
});
