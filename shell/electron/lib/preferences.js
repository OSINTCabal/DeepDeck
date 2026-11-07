/**
 * DeepDeck preferences: one owner-only JSON document under XDG config.
 *
 * The document is small and flat enough to validate by hand. Nothing secret is
 * stored here; API keys live in the harness credential store, and the DeepSeek
 * web session lives in Electron's persistent partition.
 */

const fs = require("node:fs");
const path = require("node:path");
const { defaultHarness } = require("./paths");

const THEMES = new Set(["system", "light", "dark", "midnight", "graphite", "paper"]);
const MODES = new Set(["chat", "code"]);
const ZOOM = new Set([0.75, 0.9, 1, 1.1, 1.25, 1.5]);

function defaults() {
  return {
    version: 2,
    mode: "chat",
    theme: "system",
    zoom: 1,
    firstRun: true,
    window: { width: 1440, height: 900, maximized: false, x: null, y: null },
    harness: defaultHarness(),
    updates: { autoCheck: true, autoUpdate: true },
    web: { signedIn: false, lastSignInAt: null, chatDirectory: null },
  };
}

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}

function cleanString(value, fallback, max = 4096) {
  return typeof value === "string" && value.trim() !== "" && value.length <= max
    ? value
    : fallback;
}

/** Merge arbitrary input over defaults, dropping values the app cannot use. */
function normalize(input) {
  const base = defaults();
  const source = input && typeof input === "object" ? input : {};
  const harnessInput = source.harness && typeof source.harness === "object" ? source.harness : {};
  const updatesInput = source.updates && typeof source.updates === "object" ? source.updates : {};
  const windowInput = source.window && typeof source.window === "object" ? source.window : {};
  const webInput = source.web && typeof source.web === "object" ? source.web : {};
  return {
    version: 2,
    mode: MODES.has(source.mode) ? source.mode : base.mode,
    theme: THEMES.has(source.theme) ? source.theme : base.theme,
    zoom: ZOOM.has(source.zoom) ? source.zoom : base.zoom,
    firstRun: typeof source.firstRun === "boolean" ? source.firstRun : base.firstRun,
    window: {
      width: Math.min(4096, Math.max(960, Math.round(finite(windowInput.width, base.window.width)))),
      height: Math.min(4096, Math.max(600, Math.round(finite(windowInput.height, base.window.height)))),
      maximized: windowInput.maximized === true,
      x: Number.isFinite(windowInput.x) ? Math.round(windowInput.x) : null,
      y: Number.isFinite(windowInput.y) ? Math.round(windowInput.y) : null,
    },
    harness: {
      workdir: cleanString(harnessInput.workdir, base.harness.workdir),
      port: cleanPort(harnessInput.port, base.harness.port),
      defaultWorkspaceSelected: harnessInput.defaultWorkspaceSelected === true,
    },
    updates: {
      autoCheck: typeof updatesInput.autoCheck === "boolean" ? updatesInput.autoCheck : base.updates.autoCheck,
      autoUpdate: source.version === 1 ? true
        : typeof updatesInput.autoUpdate === "boolean" ? updatesInput.autoUpdate : base.updates.autoUpdate,
    },
    web: {
      signedIn: webInput.signedIn === true,
      lastSignInAt: typeof webInput.lastSignInAt === "string" ? webInput.lastSignInAt : null,
      chatDirectory: typeof webInput.chatDirectory === "string" && webInput.chatDirectory.trim()
        ? webInput.chatDirectory
        : null,
    },
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

/** Atomic 0600 write; the rename keeps a reader from seeing a partial file. */
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
}

function createStore(file) {
  let current = normalize(readJson(file));
  let saved = readJson(file) !== null;
  if (!saved) {
    try { writeAtomic(file, current); saved = true; } catch { /* read-only home */ }
  }
  return {
    get() { return JSON.parse(JSON.stringify(current)); },
    patch(patch) {
      const next = normalize({
        ...current,
        ...patch,
        harness: { ...current.harness, ...(patch && patch.harness) },
        updates: { ...current.updates, ...(patch && patch.updates) },
        window: { ...current.window, ...(patch && patch.window) },
        web: { ...current.web, ...(patch && patch.web) },
      });
      current = next;
      try { writeAtomic(file, next); } catch { /* keep the in-memory value */ }
      return JSON.parse(JSON.stringify(next));
    },
    reload() {
      current = normalize(readJson(file));
      return JSON.parse(JSON.stringify(current));
    },
  };
}

module.exports = {
  THEMES,
  MODES,
  ZOOM,
  defaults,
  normalize,
  readJson,
  writeAtomic,
  createStore,
};
