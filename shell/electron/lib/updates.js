/** Versioned, private harness installations. Only a verified slot becomes active. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const semver = require("semver");
const { writeAtomic } = require("./preferences");
const { HarnessManager, resolveNode, findExecutable, runtimeEnvironment } = require("./harness");
const { redact } = require("./security");
const runFile = promisify(execFile);
const RELEASES_URL = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100";
const BASE_RELEASE = {
  version: "0.2.2-alpha.3", tag: "dsh-v0.2.2-alpha.3", nodeRange: ">=24.9.0", pnpmVersion: "11.28.5",
  url: "https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.3",
};
const IMPORT_FILES = [".credentials.yaml", ".env", "cordis.patch.yml", "settings.yaml", "sessions", "attachments", "storages", "llm-deepseek", ".agent-presets"];
const OMIT = new Set(["node_modules", "logs", "cache", "lock", ".lock", ".DS_Store"]);

function validRelease(value) {
  return Boolean(value && typeof value.version === "string" && semver.valid(value.version) === value.version && !value.version.includes("+")
    && value.tag === `dsh-v${value.version}` && semver.validRange(value.nodeRange)
    && semver.valid(value.pnpmVersion) === value.pnpmVersion);
}
function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function canonicalPath(value) {
  let current = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(current)) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...suffix);
}
function assertOwned(root, target) {
  if (!inside(root, target)) throw new Error("Refusing a path outside DeepDeck's harness directory");
  let current = path.resolve(root);
  for (const part of ["", ...path.relative(root, target).split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("DeepDeck's harness paths must not be symbolic links");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${path.basename(file)}; the existing installation was left untouched`);
  }
}
/** Copies own inodes only; a shared symlink is never carried into a private home. */
function copyPrivate(source, target, { skipLinks = false } = {}) {
  if (!fs.existsSync(source)) return;
  const before = fs.lstatSync(source);
  if (before.isSymbolicLink()) {
    if (skipLinks) return;
    throw new Error(`Cannot import a symbolic link: ${source}`);
  }
  if (before.isDirectory()) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) {
      if (!OMIT.has(name) && !name.endsWith(".lock")) {
        copyPrivate(path.join(source, name), path.join(target, name), { skipLinks });
      }
    }
  } else if (before.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(target, 0o600);
    const after = fs.statSync(source);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("Source data changed during import. Retry after its current write finishes.");
    }
  }
}
function importHome(source, slot) {
  fs.mkdirSync(slot.home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(slot.agentsHome, { recursive: true, mode: 0o700 });
  for (const name of IMPORT_FILES) copyPrivate(path.join(source, name), path.join(slot.home, name));
  for (const name of ["package.json", "cordis.patch.yml"]) {
    copyPrivate(path.join(source, "profiles", "web", name), path.join(slot.home, "profiles", "web", name));
  }
}
async function jsonFrom(url, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "DeepDeck" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Release check returned HTTP ${response.status}`);
  return response.json();
}
async function latestRelease(fetcher = fetch) {
  const releases = await jsonFrom(RELEASES_URL, fetcher);
  if (!Array.isArray(releases)) throw new Error("The release server returned an invalid list");
  const published = releases.filter(item => !item.draft && item.published_at && /^dsh-v/.test(item.tag_name)
    && semver.valid(item.tag_name.slice(5)) && !item.tag_name.includes("+"))
    .sort((a, b) => semver.rcompare(a.tag_name.slice(5), b.tag_name.slice(5)));
  if (!published.length) throw new Error("No published harness release was found");
  const tag = published[0].tag_name;
  const manifest = await jsonFrom(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${tag}/package.json`, fetcher);
  const release = {
    version: manifest.version, tag, nodeRange: manifest.engines?.node,
    pnpmVersion: /^pnpm@(.+)$/.exec(manifest.packageManager || "")?.[1],
    url: `https://github.com/deepseek-ai/deepseek-harness/releases/tag/${tag}`,
  };
  if (!validRelease(release)) throw new Error("The published release has unsupported runtime metadata");
  return release;
}
function packageFailure(error) {
  if (error.code === "ABORT_ERR") return Object.assign(new Error("Coding runtime setup was cancelled. Start Code again to retry; the working installation was retained."), { code: "ABORT_ERR" });
  const reason = error.killed ? "Coding runtime package setup timed out" : `Coding runtime package setup failed (${error.code || error.signal || "unknown error"})`;
  const detail = redact([error.message, error.stderr, error.stdout].filter(Boolean).join("\n")).slice(-2000);
  return Object.assign(new Error(`${reason}: ${detail}. Open the setup log for full diagnostics.`), { code: error.code });
}
async function run(runtime, command, args, { cwd = runtime.dir, signal, onProgress = () => {} } = {}) {
  const env = { ...runtimeEnvironment(runtime), CI: "1" };
  const npm = path.basename(command) === "npm";
  if (npm) delete env.npm_config_store_dir;
  const logFile = path.join(runtime.base, "install.log");
  fs.writeFileSync(logFile, `\nStarting ${npm ? "coding runtime installation" : "private plugin setup"}…\n`, { flag: "a", mode: 0o600 });
  const started = Date.now();
  const report = () => onProgress(`${npm ? "Installing coding runtime packages" : "Preparing private plugins"}… (${Math.floor((Date.now() - started) / 1000)}s)`);
  report();
  const operation = runFile(command, args, {
    cwd, env, signal, detached: process.platform !== "win32",
    timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  const output = chunk => {
    try { fs.appendFileSync(logFile, redact(String(chunk))); } catch { /* the process error still carries captured diagnostics */ }
    report();
  };
  operation.child?.stdout?.on("data", output);
  operation.child?.stderr?.on("data", output);
  const timer = setInterval(report, 1000);
  try { return await operation; }
  catch (error) {
    if (operation.child?.pid && process.platform !== "win32") {
      try { process.kill(-operation.child.pid, "SIGTERM"); } catch { /* the package process group already exited */ }
    }
    throw packageFailure(error);
  } finally { clearInterval(timer); }
}
async function installRuntime(slot, { signal, onProgress } = {}) {
  const npm = findExecutable("npm", runtimeEnvironment(slot));
  if (!npm) throw new Error("npm is required to install DeepDeck's private coding runtime");
  fs.mkdirSync(slot.dir, { recursive: true, mode: 0o700 });
  writeAtomic(path.join(slot.dir, "package.json"), { private: true, name: "deepdeck-managed-harness", version: "1.0.0" });
  await run(slot, npm, ["install", "--prefix", slot.dir, "--global=false", "--save-exact", "--no-audit", "--no-fund", "--loglevel=info", "--registry=https://registry.npmjs.org",
    `@deepseek-ai/dsh@${slot.version}`, `pnpm@${slot.pnpmVersion}`], { signal, onProgress });
  const installed = readJson(path.join(slot.dir, "node_modules", "@deepseek-ai", "dsh", "package.json"));
  if (installed?.version !== slot.version) throw new Error("Installed harness version did not match the published release");
}
function migrateEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("The imported profile patch must be a list");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("The imported profile contains an invalid patch");
    if (entry.id === "subagent-model-selection") entry.id = "subagent-model-selection-settings";
    if (entry.id === "agent-presets") {
      entry.id = "agent-preset-registry";
      if (entry.config && typeof entry.config === "object") {
        if (entry.config.default !== undefined) entry.config.selectedDefault = entry.config.default;
        delete entry.config.default;
        delete entry.config.modeSelectionEnabled;
      }
    }
    if (Array.isArray(entry.insert)) migrateEntries(entry.insert);
  }
  return entries;
}
/** Use the packaged harness's YAML dialect; !!js values are not evaluated here. */
async function migrateProfile(slot, sourceHome, { signal, onProgress } = {}) {
  const requireRuntime = createRequire(path.join(slot.dir, "package.json"));
  const yaml = requireRuntime("js-yaml");
  const { entryListSchema: schema } = await import(pathToFileURL(requireRuntime.resolve("@deepseek-ai/cordis-plugin-include")).href);
  for (const relative of ["cordis.patch.yml", "profiles/web/cordis.patch.yml"]) {
    const file = path.join(slot.home, relative);
    if (!fs.existsSync(file)) continue;
    let entries;
    try { entries = migrateEntries(yaml.load(fs.readFileSync(file, "utf8"), { schema }) || []); }
    catch { throw new Error(`Cannot migrate ${relative}; its private copy is preserved and the original was not changed`); }
    fs.writeFileSync(file, yaml.dump(entries, { schema, noRefs: true, lineWidth: -1 }), { mode: 0o600 });
  }
  const profile = path.join(slot.home, "profiles", "web");
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const file = path.join(profile, "package.json");
  const manifest = readJson(file, { private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } });
  manifest.dependencies ||= {};
  for (const [name, spec] of Object.entries(manifest.dependencies)) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || typeof spec !== "string") throw new Error("Invalid imported plugin dependency");
    if (name.startsWith("@deepseek-ai/dsh")) {
      try { requireRuntime.resolve(`${name}/package.json`); delete manifest.dependencies[name]; }
      catch { manifest.dependencies[name] = slot.version; }
    } else if (/^(file:|link:|workspace:|\.|\/|~)/.test(spec)) {
      const location = path.resolve(path.join(sourceHome, "profiles", "web"), spec.replace(/^(file:|link:)/, ""));
      if (!inside(path.join(sourceHome, "bundles"), location)) {
        throw new Error(`Plugin ${name} references an external directory; import a private copy before retrying`);
      }
      manifest.dependencies[name] = `file:${path.join(slot.home, path.relative(sourceHome, location))}`;
    } else {
      const previous = readJson(path.join(sourceHome, "profiles", "web", "node_modules", ...name.split("/"), "package.json"));
      if (semver.valid(previous?.version)) manifest.dependencies[name] = previous.version;
    }
  }
  writeAtomic(file, manifest);
  if (Object.keys(manifest.dependencies).length) {
    await run(slot, slot.node, [path.join(slot.dir, "node_modules", "pnpm", "bin", "pnpm.cjs"),
      "install", "--no-frozen-lockfile", "--ignore-workspace"], { cwd: profile, signal, onProgress });
  }
}
class RuntimeManager {
  constructor({ root, sourceHome = process.env.DSH_HOME?.trim() || path.join(os.homedir(), ".dsh"),
    sourceAgentsHome = process.env.DSH_AGENTS_HOME?.trim() || path.join(os.homedir(), ".agents"),
    fetcher = fetch, installer = installRuntime, migrate = migrateProfile, nodeResolver = resolveNode }) {
    this.root = path.resolve(root);
    this.sourceHome = path.resolve(sourceHome);
    this.sourceAgentsHome = path.resolve(sourceAgentsHome);
    for (const source of [this.sourceHome, this.sourceAgentsHome]) {
      const canonical = canonicalPath(source);
      const destination = canonicalPath(root);
      if (inside(canonical, destination) || inside(destination, canonical)) throw new Error("DeepDeck's private home must be separate from the original harness and agents homes");
    }
    assertOwned(this.root, this.root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.file = path.join(this.root, "state.json");
    assertOwned(this.root, this.file);
    this.state = readJson(this.file, { version: 1, active: null, previous: null, pending: null, failed: null, attempt: null, checkedAt: null });
    if (this.state.version !== 1 || (this.state.pending && !validRelease(this.state.pending))) throw new Error("DeepDeck's runtime state is invalid; no installation was changed");
    this.fetcher = fetcher;
    this.installer = installer;
    this.migrate = migrate;
    this.nodeResolver = nodeResolver;
    this.node = null;
    this.operation = null;
    this.abort = new AbortController();
    this.current();
  }
  save(patch) { const next = { ...this.state, ...patch }; assertOwned(this.root, this.file); writeAtomic(this.file, next); this.state = next; }
  slot(id, release) {
    if (!/^[0-9A-Za-z.-]+$/.test(id) || id.includes("..")) throw new Error("Invalid managed runtime identifier");
    const base = path.join(this.root, "versions", id);
    assertOwned(this.root, base);
    const metadata = release || readJson(path.join(base, "slot.json"));
    if (!validRelease(metadata)) throw new Error("Invalid managed release metadata");
    for (const relative of ["runtime", "home", "agents", "slot.json"]) assertOwned(this.root, path.join(base, relative));
    return { ...metadata, id, root: this.root, base, dir: path.join(base, "runtime"), home: path.join(base, "home"), agentsHome: path.join(base, "agents"), node: this.node };
  }
  current() { return this.state.active ? this.slot(this.state.active) : null; }
  status() {
    const current = this.current();
    const logId = this.state.attempt?.id || this.state.failed?.id;
    const logFile = typeof logId === "string" && /^[0-9A-Za-z.-]+$/.test(logId) && !logId.includes("..")
      ? path.join(this.root, "versions", logId, "install.log") : null;
    return {
      logFile,
      state: this.state.failed ? "failed" : this.state.pending ? "pending" : current ? "up-to-date" : "not-installed",
      version: current?.version || null, pendingVersion: this.state.pending?.version || null,
      runtimeDir: current?.dir || null, home: current?.home || null, agentsHome: current?.agentsHome || null,
      canUpdate: Boolean(this.state.pending || !current), checkedAt: this.state.checkedAt,
      error: this.state.failed?.message || this.state.checkError || null, failedVersion: this.state.failed?.version || null,
      releaseUrl: this.state.pending?.url || current?.url || BASE_RELEASE.url,
      migrationWarning: this.state.migrationWarning || null,
    };
  }
  async check() {
    const release = await latestRelease(this.fetcher);
    const current = this.current();
    this.save({ pending: !current || semver.gt(release.version, current.version) ? release : null,
      checkedAt: new Date().toISOString(), checkError: null });
    return this.status();
  }
  async prepare({ autoUpdate = true, validate, onProgress } = {}) {
    if (this.state.attempt) {
      const attempt = this.state.attempt;
      const release = this.state.pending;
      if (release && release.version === attempt.version) {
        const interrupted = this.slot(attempt.id, release);
        new HarnessManager({ getRuntime: () => interrupted, getPreferences: () => ({ harness: {} }),
          stateFile: path.join(interrupted.base, "probe.json"), logger: { info() {} } }).cleanupStale();
      }
      this.save({ failed: { version: this.state.attempt.version, message: "The previous update was interrupted; the working installation was retained. Retry from Updates." }, attempt: null });
    }
    if (!this.current() && !this.state.pending) {
      onProgress?.("Checking the latest published coding runtime…");
      try { await this.check(); } catch { this.save({ pending: BASE_RELEASE }); }
    }
    const pending = this.state.pending;
    if (pending && (!this.current() || autoUpdate) && (this.state.failed?.version !== pending.version || this.state.failed?.code === "ABORT_ERR")) {
      try { await this.update({ validate, onProgress }); } catch (error) { if (!this.current()) throw error; }
    }
    const current = this.current();
    if (!current) throw new Error(this.state.failed?.message || "The private coding runtime is not installed. Retry from Updates.");
    this.node = this.nodeResolver(current.nodeRange);
    return this.current();
  }
  update(options) {
    if (this.operation) throw new Error("A private runtime operation is already in progress");
    this.operation = this.install(options).finally(() => { this.operation = null; });
    return this.operation;
  }
  async install({ validate, onProgress = () => {} } = {}) {
    if (typeof validate !== "function") throw new Error("Runtime validation is required before promotion");
    const release = this.state.pending || (!this.current() ? BASE_RELEASE : null);
    if (!validRelease(release)) throw new Error("No published runtime update is pending");
    const previous = this.current();
    const signal = this.abort.signal;
    const slot = this.slot(`${release.version}-${randomUUID()}`, release);
    this.save({ attempt: { id: slot.id, version: slot.version }, failed: null });
    try {
      this.node = this.nodeResolver(release.nodeRange);
      slot.node = this.node;
      signal.throwIfAborted();
      fs.mkdirSync(slot.base, { recursive: true, mode: 0o700 });
      onProgress("Copying settings and sessions into a private candidate…");
      if (previous) {
        copyPrivate(previous.home, slot.home);
        copyPrivate(previous.agentsHome, slot.agentsHome);
      } else {
        importHome(this.sourceHome, slot);
        for (const name of ["AGENTS.md", "skills"]) {
          copyPrivate(path.join(this.sourceAgentsHome, name), path.join(slot.agentsHome, name), { skipLinks: true });
        }
      }
      onProgress(`Installing the official harness ${slot.version} privately…`);
      await this.installer(slot, { signal, onProgress });
      onProgress("Preparing private plugins and migrated settings…");
      await this.migrate(slot, previous?.home || this.sourceHome, { signal, onProgress });
      onProgress("Verifying the host, settings, plugins, presets, and Code page…");
      const result = await validate(slot, { signal, imported: !previous });
      signal.throwIfAborted();
      writeAtomic(path.join(slot.base, "slot.json"), release);
      this.save({ active: slot.id, previous: this.state.active, pending: null, failed: null, attempt: null,
        migrationWarning: result?.warning || null });
      onProgress(`Harness ${slot.version} is ready.`);
      return { updated: true, version: slot.version, previousVersion: previous?.version || null, harness: this.status() };
    } catch (error) {
      this.save({ failed: { id: slot.id, version: release.version, code: error.code || null, message: redact(error.message) }, attempt: null });
      // Failed slots stay private for diagnostics; working files and dependencies are never reset.
      throw error;
    }
  }
  rollbackBoot(previousId, message) {
    const candidate = this.current();
    if (!candidate || this.state.previous !== previousId) throw new Error("The startup rollback no longer matches this update");
    if (previousId) this.slot(previousId);
    const { version, tag, nodeRange, pnpmVersion, url } = candidate;
    this.save({ active: previousId, previous: null, pending: { version, tag, nodeRange, pnpmVersion, url },
      failed: { version, message: redact(message) } });
  }
  async close() { this.abort.abort(); try { await this.operation; } catch { /* failure was recorded */ } }
}
module.exports = { RuntimeManager, BASE_RELEASE, RELEASES_URL, latestRelease, validRelease, copyPrivate, importHome, migrateEntries, migrateProfile, installRuntime, assertOwned, inside, run, packageFailure };
