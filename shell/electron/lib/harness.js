/**
 * Managed `dsh web` child process.
 *
 * DeepDeck starts a harness of its own instead of attaching to a server it did
 * not start: the launch token is per-process and unpersisted, so attaching is
 * not supported. The child uses DeepDeck-owned data and agents homes, runs with the configured project directory as its cwd, and is
 * killed as a process group when the app quits.
 *
 * The authenticated URL is a bearer secret and stays in memory. Status objects
 * never include it; the log records only a redacted line.
 */

const { spawn, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { exchangeSession, createRpcClient, HarnessRpcError } = require("./harness-rpc");
const { redact } = require("./security");
const { providerEnv } = require("./provider-env");

const URL_PATTERN = /dsh web:\s*(http:\/\/127\.0\.0\.1:(\d+)\/\?token=[A-Za-z0-9_-]+)/;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const START_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 6_000;

function findExecutable(command, env = process.env) {
  for (const directory of (env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* next directory */ }
  }
  return null;
}

function nodeSupported(version, range = ">=24.9.0") {
  return require("semver").satisfies(String(version).trim().replace(/^v/, ""), range);
}

function resolveNode(range = ">=24.9.0") {
  const home = process.env.HOME || "";
  const candidates = [process.env.DEEPDECK_NODE, process.env.NODE_BINARY];
  try {
    const root = path.join(home, ".nvm", "versions", "node");
    for (const version of fs.readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      candidates.push(path.join(root, version, "bin", "node"));
    }
  } catch { /* no nvm */ }
  candidates.push(findExecutable("node"), "/usr/local/bin/node", "/usr/bin/node");
  let failure = "";
  for (const candidate of new Set(candidates.filter(Boolean))) {
    try {
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
      if (nodeSupported(version, range)) return candidate;
    } catch (error) { failure = error.code || error.message; }
  }
  throw new Error(`A usable Node.js ${range} is required for Code.${failure ? ` Last executable check: ${failure}.` : ""}`);
}

function runtimeEnvironment(runtime, env = process.env) {
  if (!runtime?.home || !runtime.agentsHome || !runtime.dir || !runtime.node) {
    throw new Error("DeepDeck's private harness runtime is not prepared");
  }
  return {
    ...env,
    PATH: [path.join(runtime.dir, "node_modules", ".bin"), path.dirname(runtime.node), env.PATH || ""].join(path.delimiter),
    DSH_HOME: runtime.home,
    DSH_AGENTS_HOME: runtime.agentsHome,
    DSH_TELEMETRY_DISABLED: "1",
    npm_config_cache: path.join(runtime.root, "cache", "npm"),
    npm_config_store_dir: path.join(runtime.root, "cache", "pnpm"),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
}

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function choosePort(preferred) {
  for (let port = preferred; port < preferred + 20 && port <= 65535; port += 1) {
    if (await isPortFree(port)) return port;
  }
  return 0;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Only launch the package installed in DeepDeck's private version directory. */
function resolveInvocation({ runtime, workdir }) {
  if (!runtime) throw new Error("DeepDeck's coding runtime has not been installed yet. Open Settings → Updates.");
  const entry = path.join(runtime.dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (!fs.existsSync(entry)) throw new Error("The private harness package is missing. Retry from Settings → Updates.");
  return { kind: "managed", command: runtime.node, args: [entry], cwd: workdir, env: runtimeEnvironment(runtime) };
}

class HarnessManager extends EventEmitter {
  constructor({ getPreferences, getRuntime, prepare, logFile, stateFile, logger, onPort, getEnvironment }) {
    super();
    this.getPreferences = getPreferences;
    this.getRuntime = getRuntime;
    this.prepare = prepare;
    this.getEnvironment = getEnvironment;
    this.logFile = logFile;
    this.stateFile = stateFile;
    this.logger = logger;
    this.onPort = onPort;
    this.child = null;
    this.tokenUrl = null;
    this.client = null;
    this.state = "stopped";
    this.error = null;
    this.port = null;
    this.startedAt = null;
    this.startPromise = null;
    this.stopPromise = null;
    this.intentionalStop = false;
    this.outputBuffer = "";
    this.invocation = null;
    this.tail = [];
    this.secrets = [];
    this.operations = new Set();
  }

  status() {
    const prefs = this.getPreferences();
    return {
      state: this.state,
      port: this.port,
      origin: this.port ? `http://127.0.0.1:${this.port}` : null,
      pid: this.child ? this.child.pid : null,
      workdir: prefs.harness.workdir,
      runtimeDir: this.getRuntime()?.dir || null,
      home: this.getRuntime()?.home || null,
      version: this.getRuntime()?.version || null,
      logFile: this.logFile,
      startedAt: this.startedAt,
      error: this.error,
      kind: this.invocation ? this.invocation.kind : null,
    };
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.emit("state", this.status());
  }

  appendTail(line) {
    this.tail.push(line);
    if (this.tail.length > 80) this.tail.shift();
  }

  log(text) {
    const clean = redact(String(text), this.secrets).replace(ANSI_PATTERN, "").trimEnd();
    if (!clean) return;
    this.appendTail(clean);
    this.logger.line(clean);
  }

  handleLine(line) {
    const clean = line.replace(ANSI_PATTERN, "");
    const match = clean.match(URL_PATTERN);
    if (match) {
      this.tokenUrl = match[1];
      this.port = Number(match[2]);
      this.log(`dsh web: http://127.0.0.1:${this.port}/?token=<redacted>`);
      void this.adoptSession(this.child);
      return;
    }
    if (clean.trim()) this.log(clean);
  }

  handleOutput(chunk) {
    this.outputBuffer += chunk.toString();
    let index;
    while ((index = this.outputBuffer.indexOf("\n")) >= 0) {
      const line = this.outputBuffer.slice(0, index);
      this.outputBuffer = this.outputBuffer.slice(index + 1);
      this.handleLine(line);
    }
  }

  async adoptSession(child) {
    if (!this.tokenUrl || !child || this.state !== "starting") return;
    try {
      const session = await exchangeSession(this.tokenUrl);
      if (this.child !== child || this.state !== "starting") return;
      this.client = createRpcClient(session);
      this.startedAt = new Date().toISOString();
      this.setState("ready");
      this.writeStateFile();
    } catch (error) {
      if (this.child !== child || this.state !== "starting") return;
      this.state = "error";
      this.error = `Harness started but its session could not be opened: ${error.message}`;
      this.log(this.error);
      this.emit("state", this.status());
    }
  }

  writeStateFile() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.stateFile, JSON.stringify({
        pid: this.child ? this.child.pid : null,
        port: this.port,
        startedAt: this.startedAt,
        appPid: process.pid,
      }, null, 2), { mode: 0o600 });
    } catch { /* state is advisory */ }
  }

  removeStateFile() {
    try { fs.unlinkSync(this.stateFile); } catch { /* already gone */ }
  }

  /** Kill a harness left behind by a dead DeepDeck process. */
  cleanupStale() {
    if (process.platform !== "linux") return;
    const state = readJson(this.stateFile);
    if (!state || !state.pid) return;
    try {
      process.kill(state.pid, 0);
    } catch {
      this.removeStateFile();
      return;
    }
    try {
      const env = fs.readFileSync(`/proc/${state.pid}/environ`, "utf8");
      if (!env.includes("DEEPDECK_MANAGED_HARNESS=") || !env.split("\0").includes(`DSH_HOME=${this.getRuntime()?.home}`)) return;
      if (state.appPid && state.appPid !== process.pid) {
        try { process.kill(state.appPid, 0); return; } catch { /* old app is gone */ }
      }
      process.kill(-state.pid, "SIGTERM");
      this.logger.info(`removed stale managed harness pid ${state.pid}`);
    } catch { /* not our process */ }
    this.removeStateFile();
  }

  start() {
    if (this.state === "ready") return Promise.resolve(this.status());
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start().catch(error => {
      if (this.state !== "error") this.setState("error", error.message);
      throw error;
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async #start() {
    this.setState("preparing");
    await this.prepare?.();
    const prefs = this.getPreferences();
    const { workdir } = prefs.harness;
    const runtime = this.getRuntime();
    if (!fs.existsSync(workdir)) throw new Error(`Default workspace not found: ${workdir}`);
    this.intentionalStop = false;
    this.error = null;
    this.outputBuffer = "";
    this.setState("starting");
    this.cleanupStale();

    let invocation;
    try {
      invocation = resolveInvocation({ runtime, workdir });
    } catch (error) {
      this.setState("error", error.message);
      throw error;
    }
    const port = await choosePort(prefs.harness.port);
    this.port = port || null;
    const args = [...invocation.args, "web"];
    args.push("--port", String(port), "--no-open");
    this.invocation = invocation;

    const providerEnvironment = this.getEnvironment ? this.getEnvironment() : { ...process.env, ...providerEnv({ env: process.env }) };
    this.secrets = Object.entries(providerEnvironment).filter(([name, value]) => /KEY|TOKEN|SECRET|PASSWORD/.test(name) && typeof value === "string" && value.length >= 8).map(([, value]) => value);
    const env = {
      // OpenCode already owns the user's Mistral, Z.ai, MiniMax, and OpenCode
      // Go keys. Give the harness the env references its routes read without
      // copying those secrets into another store.
      ...providerEnvironment,
      ...runtimeEnvironment(runtime, providerEnvironment),
      DEEPDECK_MANAGED_HARNESS: String(process.pid),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      TERM: process.env.TERM || "xterm-256color",
    };
    this.logger.info(`starting harness (${invocation.kind}) port=${port} cwd=${workdir} version=${runtime.version}`);

    let child;
    try {
      child = spawn(invocation.command, args, {
        cwd: invocation.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (error) {
      this.setState("error", `Could not start the harness: ${error.message}`);
      throw error;
    }
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (this.child === child) this.handleOutput(chunk); });
    child.stderr.on("data", chunk => { if (this.child === child) this.handleOutput(chunk); });
    child.once("error", error => {
      if (this.child === child && !child.pid) this.child = null;
      if ((this.child === child || !child.pid) && this.state !== "stopping") this.setState("error", `Harness process error: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.client = null;
      this.tokenUrl = null;
      this.removeStateFile();
      if (this.intentionalStop || this.state === "stopping") {
        this.setState("stopped");
        return;
      }
      const tails = this.tail.slice(-8).join("\n");
      this.setState("error", `Harness exited (${signal || code}).${tails ? `\n${tails}` : ""}`);
    });

    if (port) this.onPort?.(port);

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (this.state === "starting" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (!this.child && this.state === "starting") break;
    }
    if (this.state === "starting") {
      await this.stop();
      const message = "Harness startup timed out. Check the harness log.";
      this.setState("error", message);
      throw new Error(message);
    }
    if (this.state !== "ready") throw new Error(this.error || "Harness startup was cancelled");
    return this.status();
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.#stop().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  async #stop() {
    const child = this.child;
    this.intentionalStop = true;
    if (this.state === "ready" || this.state === "starting" || this.state === "error") {
      this.setState("stopping");
    }
    let operationTimer;
    await Promise.race([Promise.allSettled([...this.operations]), new Promise(resolve => {
      operationTimer = setTimeout(resolve, STOP_GRACE_MS);
    })]);
    clearTimeout(operationTimer);
    this.client = null;
    this.tokenUrl = null;
    this.removeStateFile();
    if (!child) {
      if (this.state !== "stopped") this.setState("stopped");
      return this.status();
    }
    const pid = child.pid;
    const signalGroup = signal => {
      try { process.kill(-pid, signal); return true; } catch { /* group gone */ }
      return false;
    };
    if (signalGroup("SIGTERM")) {
      const deadline = Date.now() + STOP_GRACE_MS;
      while (Date.now() < deadline && this.child === child) {
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      if (this.child === child) signalGroup("SIGKILL");
    }
    if (this.child === child) {
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", resolve);
        setTimeout(resolve, 2000).unref();
      });
      if (this.child === child) throw new Error("The managed harness did not stop; refusing to change its runtime");
    }
    this.setState("stopped");
    return this.status();
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async ensure() {
    if (this.state === "ready" && this.client) return this;
    await this.start();
    return this;
  }

  rpc() {
    if (!this.client) throw new HarnessRpcError("The harness is not ready", { code: "HARNESS_NOT_READY" });
    return this.client;
  }

  /** The per-process authenticated URL. Main uses it only to open the code view. */
  authenticatedUrl() {
    return this.tokenUrl;
  }

  /** Run an RPC operation, refreshing a stale cookie once after a 401. */
  withRpc(operation) {
    const pending = this.runRpc(operation);
    this.operations.add(pending);
    return pending.finally(() => this.operations.delete(pending));
  }

  async runRpc(operation) {
    if (this.state === "stopping") throw new HarnessRpcError("The private harness is stopping");
    await this.ensure();
    if (this.state === "stopping") throw new HarnessRpcError("The private harness is stopping");
    try {
      return await operation(this.rpc());
    } catch (error) {
      const unauthorized = error && (error.status === 401);
      if (!unauthorized || !this.tokenUrl) throw error;
      const session = await exchangeSession(this.tokenUrl);
      this.client = createRpcClient(session);
      return operation(this.rpc());
    }
  }

  tailLines(count = 40) {
    return this.tail.slice(-count).join("\n");
  }
}

module.exports = {
  HarnessManager,
  resolveInvocation,
  choosePort,
  isPortFree,
  resolveNode,
  nodeSupported,
  findExecutable,
  runtimeEnvironment,
  URL_PATTERN,
};
