/**
 * DeepDeck Electron main process.
 *
 * One frameless window hosts a tiny React shell plus two top-level
 * WebContentsViews: the real DeepSeek web chat and the real dsh Web GUI. The
 * shell owns only app chrome and a native control panel; both products keep
 * their own UI and sessions.
 *
 * The harness is a managed child process. Its authenticated launch URL is a
 * bearer secret and never leaves this process except as the code view URL.
 */

const {
  app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, session, clipboard,
  nativeTheme, Menu, screen,
} = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { paths, ensureDirs } = require("./lib/paths");
const { createStore, ZOOM } = require("./lib/preferences");
const ZOOM_LEVELS = [...ZOOM];
const { createLogger, tail } = require("./lib/logger");
const { createStaticServer } = require("./lib/static-server");
const {
  createTrustedSender, chromeUserAgent, externalUrl, redact, isPrivateNetworkHost,
} = require("./lib/security");
const { HarnessManager } = require("./lib/harness");
const { HarnessStartup } = require("./lib/harness-startup");
const { createViewManager } = require("./lib/views");
const { createWebSession } = require("./lib/web-session");
const {
  loadProviders, saveProvider, setProviderKey, removeProviderKey,
  removeProvider, setDefaultModel, discoverModels,
} = require("./lib/providers");
const { ensureProviderDefaults } = require("./lib/provider-defaults");
const { RuntimeManager, assertOwned } = require("./lib/updates");
const { verifyCompatibility } = require("./lib/harness-compatibility");
const { verifyCodePage } = require("./lib/harness-page");
const {
  loadSubagents, saveSubagents, createDeepDeckPreset, setPresetDefault, removeDeepDeckPreset,
  installBackend, removeBackend, preparePresets, presetDirectory,
} = require("./lib/subagents");

const APP_VERSION = "1.0.0";
const BAR_HEIGHT = 40;
const THEME_IDS = ["system", "light", "dark", "midnight", "graphite", "paper"];
const LIGHT_THEMES = new Set(["light", "paper"]);

function nativeThemeFor(theme) {
  if (theme === "system") return "system";
  return LIGHT_THEMES.has(theme) ? "light" : "dark";
}

/** Embedded chat/harness clients only understand light, dark, or system. */
function embeddedThemeFor(theme) {
  if (theme === "system") return "system";
  return LIGHT_THEMES.has(theme) ? "light" : "dark";
}
const CHAT_PARTITION = "persist:deepseek-chat";
const HARNESS_PARTITION = "persist:deepdeck-harness";
const USAGE_PARTITION = "persist:deepseek-platform";
const USAGE_URL = "https://platform.deepseek.com/usage";

if (process.platform === "linux") app.setDesktopName("deepdeck.desktop");
app.setName("DeepDeck");
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");
if (process.platform === "linux") app.commandLine.appendSwitch("ozone-platform-hint", "auto");

const resolvedPaths = ensureDirs();
app.setPath("userData", resolvedPaths.electronData);

const prefs = createStore(resolvedPaths.configFile);
const logger = createLogger(resolvedPaths.mainLog);
const harnessLogger = createLogger(resolvedPaths.harnessLog);
const USER_AGENT = chromeUserAgent(process.versions.chrome);
app.userAgentFallback = USER_AGENT;

/**
 * Chromium falls back to the user's Documents directory for a file chooser
 * that has no last-used folder. Pointing that at the workspace is what makes
 * the first attach in Chat land in the same directory coding mode uses. The
 * chat preload also passes the workspace explicitly to its own picker; this
 * covers any other Chromium-owned dialog.
 */
function applyWorkspacePaths(state = prefs.get()) {
  const workdir = state && state.harness && state.harness.workdir;
  if (!workdir) return;
  try {
    if (fs.existsSync(workdir)) app.setPath("documents", workdir);
  } catch (error) {
    logger.warn(`workspace documents path not applied: ${error.message}`);
  }
}
applyWorkspacePaths();

let win = null;
let shellOrigin = null;
let shellServer = null;
let viewManager = null;
let harness = null;
let webSession = null;
let quitting = false;
let cleanedUp = false;
let stateTimer = null;
let workspaceTimer = null;
let providerDefaultsTried = false;
let updateCheckTimer = null;
let updateCheckInterval = null;
let updateState = {
  checking: false,
  checkedAt: null,
  error: null,
  progress: null,
  harness: null,
  app: null,
};
let updateBusy = false;
let runtimeManager = null;
let harnessStartup = null;

function rawArgs() {
  const argv = process.argv.slice(process.defaultApp ? 2 : 1);
  return argv.filter(argument => argument !== "--");
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const prefixed = args.find(argument => argument.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : null;
}

function has(args, name) {
  return args.includes(name);
}

const cli = rawArgs();
if (has(cli, "--version") || has(cli, "-V")) {
  console.log(`DeepDeck ${APP_VERSION}`);
  app.exit(0);
} else if (has(cli, "--help") || has(cli, "-h")) {
  console.log(`DeepDeck ${APP_VERSION}
Usage: DeepDeck [options]
  --chat            open chat mode
  --code            open coding mode
  --settings        open Settings
  --dir <path>      override the default workspace directory
  --stop            stop a harness started by DeepDeck and exit
  --version         print the version
  --help            show this help`);
  app.exit(0);
} else if (optionValue(cli, "--harness")) {
  console.error("DeepDeck uses its own private harness. The --harness checkout override is no longer supported.");
  app.exit(1);
} else if (has(cli, "--stop")) {
  stopManagedHarness(resolvedPaths.harnessState);
  console.log("DeepDeck harness stopped (if it was running).");
  app.exit(0);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function stopManagedHarness(stateFile) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (!state || !state.pid) return;
    if (process.platform === "linux") {
      const env = fs.readFileSync(`/proc/${state.pid}/environ`, "utf8");
      if (!env.includes("DEEPDECK_MANAGED_HARNESS=")) return;
      const home = env.split("\0").find(item => item.startsWith("DSH_HOME="))?.slice(9);
      if (!home || !home.startsWith(`${resolvedPaths.harnessRoot}${path.sep}`)) return;
    }
    try { process.kill(-state.pid, "SIGTERM"); } catch { /* already gone */ }
    try { process.kill(state.pid, "SIGTERM"); } catch { /* already gone */ }
    for (let i = 0; i < 30; i += 1) {
      try { process.kill(state.pid, 0); } catch { break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    try { process.kill(-state.pid, "SIGKILL"); } catch { /* already gone */ }
  } catch { /* no managed harness */ }
  try { fs.unlinkSync(stateFile); } catch { /* already gone */ }
}

function bootstrap() {
  app.on("second-instance", (_event, argv) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    // Electron's second-instance argv shape varies between a packaged app and
    // a default-app launch, so search the whole vector for our own flags.
    applyCliMode(argv);
  });

  app.whenReady().then(onReady).catch(error => {
    logger.error(`startup failed: ${error.stack || error.message}`);
    dialog.showErrorBox("DeepDeck could not start", redact(error.message));
    app.exit(1);
  });

  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (!win) return;
    win.show();
    win.focus();
  });
  app.on("before-quit", event => {
    if (cleanedUp) return;
    event.preventDefault();
    cleanup().finally(() => {
      cleanedUp = true;
      app.quit();
    });
  });
}

function applyCliMode(args) {
  if (!viewManager) return;
  if (has(args, "--settings")) {
    viewManager.setSettings(true);
  } else if (has(args, "--code")) {
    viewManager.setSettings(false);
    safelySetMode("code");
  } else if (has(args, "--chat")) {
    viewManager.setSettings(false);
    safelySetMode("chat");
  }
  scheduleState();
}

function safelySetMode(mode) {
  try {
    viewManager.setMode(mode);
    prefs.patch({ mode });
  } catch (error) {
    logger.warn(`mode switch failed: ${error.message}`);
  }
}

async function onReady() {
  nativeTheme.themeSource = nativeThemeFor(prefs.get().theme);
  Menu.setApplicationMenu(null);

  const shellBuild = process.env.DEEPDECK_SHELL_URL;
  if (shellBuild) {
    const parsed = new URL(shellBuild);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error("DEEPDECK_SHELL_URL must be a loopback HTTP URL");
    }
    shellOrigin = parsed.origin;
  } else {
    shellServer = await createStaticServer({ root: resolvedPaths.frontendDist });
    shellOrigin = shellServer.origin;
  }

  const dirOverride = optionValue(cli, "--dir");
  if (dirOverride) {
    const resolved = path.resolve(dirOverride);
    if (!fs.existsSync(resolved)) throw new Error(`Workspace not found: ${resolved}`);
    prefs.patch({ harness: { workdir: resolved, defaultWorkspaceSelected: false } });
  }
  runtimeManager = new RuntimeManager({ root: resolvedPaths.harnessRoot });

  harness = new HarnessManager({
    getPreferences: () => prefs.get(),
    getRuntime: () => runtimeManager.current(),
    logFile: resolvedPaths.harnessLog,
    stateFile: resolvedPaths.harnessState,
    logger: harnessLogger,
    onPort: port => prefs.patch({ harness: { port } }),
  });
  harness.on("state", onHarnessState);

  const chatSession = session.fromPartition(CHAT_PARTITION);
  const codeSession = session.fromPartition(HARNESS_PARTITION);
  const usageSession = session.fromPartition(USAGE_PARTITION);
  hardenDownloads(codeSession, "harness");
  hardenDownloads(chatSession, "chat");
  hardenDownloads(usageSession, "usage");
  blockPrivateNetwork(chatSession, "chat");
  blockPrivateNetwork(usageSession, "usage");
  usageSession.setUserAgent(USER_AGENT);
  codeSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
  usageSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
  usageSession.setPermissionCheckHandler((_contents, permission) => permission === "clipboard-sanitized-write");

  createWindow();

  viewManager = createViewManager({
    getWindow: () => win,
    getPreferences: () => prefs.get(),
    chatSession,
    codeSession,
    usageSession,
    chatPreload: path.join(__dirname, "chat-preload.js"),
    codePreload: path.join(__dirname, "code-preload.js"),
    logger,
    onGoogleAuth: () => {
      if (!webSession) return;
      void webSession.switchToChrome()
        .then(() => scheduleState())
        .catch(error => logger.warn(`Google fallback could not start: ${error.message}`));
    },
    onState: state => {
      broadcast("view:state", state);
      scheduleState();
    },
  });
  wireShortcuts(win.webContents, "shell");

  webSession = createWebSession({
    partition: chatSession,
    markerFile: resolvedPaths.webMarker,
    sessionFile: resolvedPaths.webSession,
    profileDir: resolvedPaths.webProfile,
    userAgent: USER_AGENT,
    logger,
    getWindow: () => win,
    getChatContents: () => viewManager?.chatContents(),
    reloadChat: () => {
      if (!viewManager) return;
      viewManager.reloadChat();
    },
    notify: () => scheduleState(),
  });
  ipcMain.on("webchat:theme", event => {
    try {
      const contents = viewManager?.chatContents();
      event.returnValue = contents && event.sender === contents ? embeddedThemeFor(prefs.get().theme) : null;
    } catch {
      event.returnValue = null;
    }
  });
  ipcMain.on("webchat:seed", event => {
    try {
      const contents = viewManager?.chatContents();
      event.returnValue = contents && event.sender === contents
        ? webSession.seedFor("https://chat.deepseek.com")
        : null;
    } catch {
      event.returnValue = null;
    }
  });
  webSession.onState(status => {
    broadcast("web:state", status);
    scheduleState();
  });

  await webSession.restore().catch(error => logger.warn(`web session restore failed: ${error.message}`));
  viewManager.createChat();
  wireShortcuts(viewManager.chatContents(), "chat");
  const chatContents = viewManager.chatContents();
  const verifyChatSession = debounce(() => {
    if (!webSession || !chatContents) return;
    void webSession.verifyNow().then(() => scheduleState()).catch(() => {});
  }, 1600);
  if (chatContents) {
    chatContents.on("did-finish-load", verifyChatSession);
    chatContents.on("did-navigate", (_event, _url, _code, _text, isMainFrame) => {
      if (isMainFrame !== false) verifyChatSession();
    });
    chatContents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame !== false) verifyChatSession();
    });
    chatContents.on("did-finish-load", async () => {
      try {
        const host = new URL(chatContents.getURL()).hostname;
        if (!host.endsWith("google.com")) return;
        const body = await chatContents.executeJavaScript("document.body.innerText", true);
        if (/couldn.t sign you in|may not be secure|disallowed_useragent/i.test(String(body || ""))) {
          await webSession?.switchToChrome();
          await chatContents.loadURL("https://chat.deepseek.com/sign_in").catch(() => {});
          scheduleState();
        }
      } catch { /* page may be navigating */ }
    });
  }
  viewManager.setZoom(prefs.get().zoom);
  viewManager.setMode(prefs.get().mode);
  applyCliMode(cli);

  registerIpc();
  scheduleState(true);

  harness.cleanupStale();
  harnessStartup = new HarnessStartup({ harness, runtime: runtimeManager, getAutoUpdate: () => prefs.get().updates.autoUpdate,
    validate: validateRuntime, onProgress: reportUpdateProgress, onRuntimeChange: () => viewManager.resetCodeCache(),
    onBusy: busy => {
      updateBusy = busy;
      updateState = { ...updateState, startedAt: busy ? new Date().toISOString() : null, harness: runtimeManager.status() };
      scheduleState(true);
    } });
  void harnessStartup.start().catch(error => logger.error(`private harness start failed: ${redact(error.message)}`));
  scheduleUpdateChecks();

  if (prefs.get().window.maximized) win.maximize();
}

function createWindow() {
  const state = prefs.get();
  const display = screen.getPrimaryDisplay().workArea;
  const width = Math.min(state.window.width, display.width);
  const height = Math.min(state.window.height, display.height);
  const useStoredPosition = Number.isFinite(state.window.x) && Number.isFinite(state.window.y);
  win = new BrowserWindow({
    width,
    height,
    x: useStoredPosition ? state.window.x : Math.round(display.x + (display.width - width) / 2),
    y: useStoredPosition ? state.window.y : Math.round(display.y + (display.height - height) / 2),
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: "#f6f7f9",
    title: "DeepDeck",
    icon: path.join(resolvedPaths.appRoot, "packaging", "deepdeck-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin === shellOrigin) return;
    } catch { /* fall through */ }
    event.preventDefault();
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
  });
  win.webContents.on("page-title-updated", event => event.preventDefault());
  win.once("ready-to-show", () => win.show());
  win.on("maximize", () => { saveWindowState(); broadcastWindowState(); viewManager?.layout(); });
  win.on("unmaximize", () => { saveWindowState(); broadcastWindowState(); viewManager?.layout(); });
  win.on("enter-full-screen", () => { broadcastWindowState(); viewManager?.layout(); });
  win.on("leave-full-screen", () => { broadcastWindowState(); viewManager?.layout(); });
  // Embedded views do not follow BrowserWindow resizes on their own. Keep their
  // bounds in lockstep with the content area, or the page lays out at its old
  // width and appears clipped off to the right after a resize.
  win.on("resize", () => viewManager?.layout());
  win.on("resize", debounce(saveWindowState, 400));
  win.on("move", debounce(saveWindowState, 400));
  win.on("closed", () => { win = null; });

  const startUrl = process.env.DEEPDECK_SHELL_URL || shellOrigin;
  win.loadURL(startUrl);
  win.webContents.on("did-finish-load", () => {
    win?.webContents.setZoomFactor(prefs.get().zoom);
    broadcastWindowState();
  });
  win.webContents.on("did-fail-load", (_event, code) => {
    if (code !== -3) logger.error(`shell failed to load: ${code}`);
  });
}

/**
 * Keep the remote chat page away from loopback/private services: the harness,
 * the shell's static server, printers, routers, and other local apps. This is a
 * URL-hostname filter; Chromium's origin/CORS rules still apply underneath.
 */
function blockPrivateNetwork(targetSession, label) {
  const blocked = new Set();
  targetSession.webRequest.onBeforeRequest({ urls: ["*://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
    try {
      const hostname = new URL(details.url).hostname;
      if (isPrivateNetworkHost(hostname)) {
        if (!blocked.has(hostname)) {
          blocked.add(hostname);
          logger.warn(`${label}: blocked a local network request (${hostname})`);
        }
        callback({ cancel: true });
        return;
      }
    } catch {
      // Malformed URL: let Chromium decide whether to load it.
    }
    callback({});
  });
}

function hardenDownloads(targetSession, label) {
  targetSession.on("will-download", (event, item, contents) => {
    item.setSaveDialogOptions({ title: `Save ${label} file` });
    item.once("done", (_event, state) => {
      if (state === "completed") logger.info(`${label} download saved`);
      else if (state === "interrupted") logger.warn(`${label} download interrupted`);
    });
  });
}

// Chat's hidden <input type=file> cannot choose its own starting folder.
// Electron's dialog can, so the chat preload replaces the click with this
// picker and hands the selected bytes back to the page as File objects.
// One IPC response carries every selected file. Keep the total below the
// structured-clone message ceiling and avoid pinning hundreds of megabytes in
// the main process; DeepSeek receives the same File objects either way.
const ATTACHMENT_LIMIT = 64 * 1024 * 1024;
const ATTACHMENT_TOTAL_LIMIT = 96 * 1024 * 1024;
const ATTACHMENT_TYPES = {
  ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
  ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".json": "application/json",
  ".jsonl": "application/json", ".yaml": "application/yaml", ".yml": "application/yaml",
  ".xml": "application/xml", ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".ts": "text/plain", ".tsx": "text/plain", ".jsx": "text/plain", ".py": "text/x-python",
  ".go": "text/plain", ".rs": "text/plain", ".c": "text/x-c", ".h": "text/x-c",
  ".cpp": "text/x-c++", ".java": "text/x-java", ".sh": "text/x-shellscript",
  ".log": "text/plain", ".ini": "text/plain", ".conf": "text/plain", ".toml": "text/plain",
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function attachmentType(filePath) {
  return ATTACHMENT_TYPES[path.extname(filePath).toLowerCase()] || "";
}

function megabytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Electron's clipboard write can be a no-op under some Ozone/Wayland setups.
 * Prefer the standard CLI clipboard helper when installed, then fall back to
 * Electron's clipboard. wl-copy/xclip fork and keep serving the selection; the
 * synchronous call returns as soon as the helper forks (about 50-100 ms).
 */
function copyTextToSystemClipboard(text) {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  const candidates = wayland
    ? [
      "/usr/bin/wl-copy", "/usr/local/bin/wl-copy", "/bin/wl-copy",
      "/usr/bin/xclip", "/usr/local/bin/xclip", "/bin/xclip",
    ]
    : ["/usr/bin/xclip", "/usr/local/bin/xclip", "/bin/xclip"];
  const helper = candidates.find(candidate => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  if (helper) {
    try {
      const args = helper.includes("xclip") ? ["-selection", "clipboard"] : [];
      execFileSync(helper, args, {
        input: text,
        timeout: 1500,
        stdio: ["pipe", "ignore", "ignore"],
      });
      return;
    } catch (error) {
      logger.warn(`system clipboard helper failed: ${error.message}`);
    }
  }
  try { clipboard.writeText(text); } catch { /* headless session */ }
}

let directoryPickerBusy = false;

/**
 * Set the local folder that roots chat's paperclip picker. This does not read
 * or upload anything: the remote chat page cannot browse a local directory,
 * and DeepDeck deliberately does not give it one. The grant only changes where
 * the explicit file picker starts.
 */
async function grantChatDirectory() {
  if (directoryPickerBusy) return { granted: false, canceled: true, busy: true };
  const contents = viewManager?.chatContents();
  if (!contents || contents.isDestroyed()) throw new Error("DeepSeek chat is still starting.");
  directoryPickerBusy = true;
  try {
    const current = prefs.get().web.chatDirectory;
    const workdir = prefs.get().harness.workdir;
    const start = current && fs.existsSync(current) ? current : (fs.existsSync(workdir) ? workdir : os.homedir());
    const picked = await dialog.showOpenDialog(win, {
      title: "Set the folder for DeepSeek chat file access",
      defaultPath: start,
      buttonLabel: "Use this folder",
      properties: ["openDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { granted: false, canceled: true };
    const folder = picked.filePaths[0];
    prefs.patch({ web: { chatDirectory: folder } });
    const name = path.basename(folder) || folder;
    contents.send("webchat:directory", { name });
    await dialog.showMessageBox(win, {
      type: "info",
      title: "Chat folder set",
      message: `${name} is now the chat file-access folder.`,
      detail: "The paperclip picker will start here. chat.deepseek.com cannot browse the folder itself; DeepDeck reads and sends only the files you explicitly choose to attach.",
      buttons: ["OK"],
      noLink: true,
    });
    logger.info(`chat directory grant set (${name})`);
    return { granted: true, name };
  } finally {
    directoryPickerBusy = false;
  }
}

async function openWorkspaceFolder() {
  const folder = prefs.get().harness.workdir;
  if (!fs.existsSync(folder)) throw new Error(`Workspace not found: ${folder}`);
  const problem = await shell.openPath(folder);
  if (problem) throw new Error(problem);
  return true;
}

async function pickChatFiles(options = {}) {
  const granted = prefs.get().web.chatDirectory;
  const workdir = prefs.get().harness.workdir;
  const base = granted && fs.existsSync(granted) ? granted : workdir;
  const result = await dialog.showOpenDialog(win, {
    title: `Attach files from ${path.basename(base)}`,
    defaultPath: fs.existsSync(base) ? base : undefined,
    buttonLabel: "Attach",
    // Deliberately unfiltered: the workspace is visible even when it contains
    // file types the chat UI will reject later. The page owns its own rules.
    properties: options.multiple ? ["openFile", "multiSelections"] : ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, canceled: true, files: [] };
  }

  const files = [];
  let total = 0;
  for (const filePath of result.filePaths) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (error) {
      logger.warn(`attachment stat failed: ${error.message}`);
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > ATTACHMENT_LIMIT || total + stat.size > ATTACHMENT_TOTAL_LIMIT) {
      await dialog.showMessageBox(win, {
        type: "warning",
        title: "Attachment too large",
        message: `${path.basename(filePath)} is too large to attach.`,
        detail: `DeepDeck attaches up to ${megabytes(ATTACHMENT_LIMIT)} per file and ${megabytes(ATTACHMENT_TOTAL_LIMIT)} total.`,
        buttons: ["OK"],
      });
      return { ok: false, message: "The selected files were too large to attach." };
    }
    let data;
    try {
      data = await fs.promises.readFile(filePath);
    } catch (error) {
      logger.warn(`attachment read failed: ${error.message}`);
      continue;
    }
    total += stat.size;
    files.push({
      name: path.basename(filePath),
      type: attachmentType(filePath),
      size: stat.size,
      lastModified: Math.round(stat.mtimeMs),
      data,
    });
  }
  logger.info(`chat picker attached ${files.length} file(s)`);
  return { ok: true, canceled: false, files };
}

function updatesView() {
  const current = prefs.get();
  return {
    checking: updateState.checking,
    busy: updateBusy,
    startedAt: updateState.startedAt || null,
    checkedAt: updateState.checkedAt,
    error: updateState.error,
    progress: updateState.progress,
    harness: updateState.harness,
    app: updateState.app,
    autoCheck: current.updates.autoCheck,
    autoUpdate: current.updates.autoUpdate,
  };
}

async function appUpdateInfo() {
  const installed = path.resolve(resolvedPaths.appRoot) === path.resolve(resolvedPaths.dataDir);
  return { version: APP_VERSION, appRoot: resolvedPaths.appRoot, installed, kind: installed ? "installed" : "source",
    message: "Pull the DeepDeck source and rerun packaging/install.sh to update the desktop shell. Coding runtime releases update separately." };
}

function reportUpdateProgress(progress) {
  updateState = { ...updateState, progress };
  scheduleState();
}

async function validateRuntime(runtime, { signal, imported }) {
  const probe = new HarnessManager({ getPreferences: () => ({ harness: { ...prefs.get().harness, port: 0 } }),
    getRuntime: () => runtime, logFile: resolvedPaths.harnessLog,
    stateFile: path.join(runtime.base, "probe.json"), logger: harnessLogger });
  const abort = () => { void probe.stop().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await probe.start();
    signal.throwIfAborted();
    const warning = await preparePresets(probe, runtime, { imported });
    await verifyCompatibility(probe.rpc());
    await verifyCodePage(probe.authenticatedUrl(), signal);
    return { warning };
  } finally {
    signal.removeEventListener("abort", abort);
    await probe.stop();
  }
}

async function checkUpdates({ fetch = true } = {}) {
  if (updateState.checking || updateBusy) return updatesView();
  updateState = { ...updateState, checking: true, error: null, progress: null };
  scheduleState();
  try {
    const harnessUpdate = fetch ? await runtimeManager.check() : runtimeManager.status();
    const app = await appUpdateInfo();
    updateState = {
      ...updateState,
      checking: false,
      checkedAt: new Date().toISOString(),
      error: null,
      harness: harnessUpdate,
      app,
    };
    scheduleState();
    return updatesView();
  } catch (error) {
    updateState = {
      ...updateState,
      checking: false,
      checkedAt: new Date().toISOString(),
      error: redact(error.message),
    };
    scheduleState();
    return updatesView();
  }
}

async function applyUpdates() {
  if (updateBusy || updateState.checking) throw new Error("Wait for the current runtime operation to finish.");
  const previousRuntimeId = runtimeManager.current()?.id || null;
  updateBusy = true;
  updateState = { ...updateState, error: null, startedAt: new Date().toISOString() };
  harness.setState("preparing");
  try {
    await harness.stop();
    viewManager.destroyCode();
    const result = await runtimeManager.update({ validate: validateRuntime, onProgress: reportUpdateProgress });
    await viewManager.resetCodeCache();
    providerDefaultsTried = false;
    await harness.start();
    return result;
  } catch (error) {
    updateState = { ...updateState, error: redact(error.message) };
    await harness.stop();
    if (runtimeManager.current()?.id && runtimeManager.current().id !== previousRuntimeId) runtimeManager.rollbackBoot(previousRuntimeId, error.message);
    if (runtimeManager.current()) {
      await runtimeManager.prepare({ autoUpdate: false });
      await harness.start().catch(startError => logger.error(`working harness restart: ${redact(startError.message)}`));
    }
    throw error;
  } finally {
    updateBusy = false;
    updateState = { ...updateState, progress: null, startedAt: null, harness: runtimeManager.status() };
    scheduleState();
  }
}

async function changeHarness(operation) {
  if (updateBusy) throw new Error("Wait for the current runtime operation to finish.");
  updateBusy = true;
  try { return await operation(); }
  finally { updateBusy = false; scheduleState(); }
}

function scheduleUpdateChecks() {
  clearTimeout(updateCheckTimer);
  clearInterval(updateCheckInterval);
  updateCheckTimer = setTimeout(() => {
    if (prefs.get().updates.autoCheck) void checkUpdates({ fetch: true }).catch(() => {});
  }, 3500);
  updateCheckInterval = setInterval(() => {
    if (prefs.get().updates.autoCheck) void checkUpdates({ fetch: true }).catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

function onHarnessState(status) {
  broadcast("harness:state", status);
  if (status.state === "ready") {
    // A theme chosen while the harness was still starting must be applied once
    // the host settings API is reachable.
    void syncHarnessTheme(prefs.get().theme).catch(() => {});
  }
  if (!viewManager) return;
  const url = harness.authenticatedUrl();
  if (status.state === "ready" && url) {
    const created = viewManager.createCode(url);
    wireShortcuts(created.webContents, "code");
    if (!providerDefaultsTried) {
      providerDefaultsTried = true;
      void harness.withRpc(rpc => ensureProviderDefaults(rpc, {
        logger,
        seedFile: path.join(path.dirname(resolvedPaths.configFile), "provider-defaults.json"),
      }))
        .then(added => { if (added.length > 0) scheduleState(); })
        .catch(error => {
          providerDefaultsTried = false;
          logger.warn(`provider defaults not applied: ${error.message}`);
        });
    }
    void alignThemeFromHarness();
    if (!prefs.get().harness.defaultWorkspaceSelected) {
      clearTimeout(workspaceTimer);
      const attempt = (delay, retries) => {
        workspaceTimer = setTimeout(async () => {
          if (prefs.get().harness.defaultWorkspaceSelected) return;
          const result = await revealHarnessWorkspace();
          if (result.selected) prefs.patch({ harness: { defaultWorkspaceSelected: true } });
          else if (retries > 0) attempt(3500, retries - 1);
          scheduleState();
        }, delay);
      };
      attempt(2200, 1);
    }
  } else if (status.state !== "ready") {
    viewManager.destroyCode();
  }
  scheduleState();
}

function windowState() {
  if (!win || win.isDestroyed()) {
    return { maximized: false, minimized: false, fullscreen: false };
  }
  return {
    maximized: win.isMaximized(),
    minimized: win.isMinimized(),
    fullscreen: win.isFullScreen(),
  };
}

function broadcastWindowState() {
  broadcast("window:state", windowState());
}

function broadcast(channel, payload) {
  try {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  } catch { /* the shell may still be navigating */ }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized() || win.isFullScreen()) return;
  if (win.isMaximized()) {
    prefs.patch({ window: { maximized: true } });
    return;
  }
  const bounds = win.getBounds();
  prefs.patch({
    window: {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: false,
    },
  });
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function appState() {
  const state = prefs.get();
  const web = webSession ? await webSession.status() : { signedIn: false, busy: false, phase: "idle" };
  return {
    platform: process.platform,
    version: APP_VERSION,
    shellOrigin,
    mode: viewManager ? viewManager.state().mode : state.mode,
    settingsOpen: viewManager ? viewManager.state().settingsOpen : false,
    overlayOpen: viewManager ? viewManager.state().overlayOpen : false,
    focusMode: viewManager ? viewManager.state().focusMode : false,
    zoom: state.zoom,
    prefs: state,
    harness: harness ? harness.status() : { state: "stopped" },
    web,
    updates: updatesView(),
    views: viewManager ? viewManager.state() : null,
    paths: {
      configFile: resolvedPaths.configFile,
      dataDir: resolvedPaths.dataDir,
      logsDir: resolvedPaths.logsDir,
      harnessLog: resolvedPaths.harnessLog,
      webMarker: resolvedPaths.webMarker,
    },
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  };
}

function scheduleState(force = false) {
  if (force) {
    clearTimeout(stateTimer);
    void sendState();
    return;
  }
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => { void sendState(); }, 80);
}

let sendingState = false;
let pendingState = false;
async function sendState() {
  if (sendingState) { pendingState = true; return; }
  sendingState = true;
  try {
    broadcast("state:changed", await appState());
  } catch (error) {
    logger.warn(`state broadcast failed: ${error.message}`);
  } finally {
    sendingState = false;
    if (pendingState) {
      pendingState = false;
      scheduleState();
    }
  }
}

function trusted(handler) {
  const check = createTrustedSender(() => win, () => shellOrigin);
  return async (event, ...args) => {
    if (!check(event)) throw new Error("Untrusted desktop request");
    return handler(...args);
  };
}

function ok(value) {
  return { ok: true, value };
}

function fail(error) {
  return {
    ok: false,
    error: {
      code: (error && error.code) || "DEEPDECK_ERROR",
      message: redact((error && error.message) || String(error)),
      details: error && error.details ? error.details : null,
    },
  };
}

function wrap(handler) {
  return trusted(async (...args) => {
    try {
      return ok(await handler(...args));
    } catch (error) {
      logger.warn(`operation failed: ${error.message}`);
      return fail(error);
    }
  });
}

const wiredShortcuts = new WeakSet();

function wireShortcuts(contents, kind) {
  // A harness restart can hand back the existing WebContentsView. Without this
  // guard every restart would add another before-input-event listener and make
  // toggles fire twice.
  if (!contents || wiredShortcuts.has(contents)) return;
  wiredShortcuts.add(contents);
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const key = input.key;
    const toggleZoom = factor => applyZoom(factor);
    if (ctrl && key.toLowerCase() === "k" && kind !== "shell") {
      event.preventDefault();
      broadcast("app:command", { type: "palette" });
      return;
    }
    if (ctrl && key === "1") { event.preventDefault(); safelySetMode("chat"); viewManager.setFocus(false); return; }
    if (ctrl && key === "2") { event.preventDefault(); safelySetMode("code"); viewManager.setFocus(false); return; }
    if (ctrl && key === ",") {
      event.preventDefault();
      viewManager.setSettings(!viewManager.state().settingsOpen);
      scheduleState();
      return;
    }
    if (ctrl && input.shift && key.toLowerCase() === "f") {
      event.preventDefault();
      viewManager.setFocus(!viewManager.state().focusMode);
      return;
    }
    if (key === "F11") {
      event.preventDefault();
      if (win) win.setFullScreen(!win.isFullScreen());
      return;
    }
    if (key === "Escape" && viewManager.state().focusMode) {
      event.preventDefault();
      viewManager.setFocus(false);
      return;
    }
    if (ctrl && key.toLowerCase() === "r") {
      event.preventDefault();
      if (kind === "shell") viewManager.reload();
      else contents.reload();
      return;
    }
    if (ctrl && input.shift && key.toLowerCase() === "i") {
      event.preventDefault();
      const target = kind === "shell" ? win.webContents : contents;
      target.toggleDevTools();
      return;
    }
    if (ctrl && (key === "0" || key === "=" || key === "+" || key === "-")) {
      event.preventDefault();
      const current = prefs.get().zoom;
      const index = ZOOM_LEVELS.indexOf(current);
      const next = key === "0" ? 1
        : key === "-"
          ? ZOOM_LEVELS[Math.max(0, index - 1)]
          : ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, index + 1)];
      toggleZoom(next);
    }
  });
}

function applyZoom(factor) {
  if (!ZOOM.has(factor)) throw new Error("Invalid zoom factor");
  prefs.patch({ zoom: factor });
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(factor);
  viewManager?.setZoom(factor);
  scheduleState();
}

async function syncHarnessTheme(theme) {
  if (!harness || harness.status().state !== "ready") return false;
  try {
    return await harness.withRpc(async rpc => {
      const describe = await rpc.describeSettings();
      const view = (describe.namespaces || []).find(entry => entry.ns === "ui-theme");
      if (!view) return false;
      const current = view.value && typeof view.value.preference === "string" ? view.value.preference : null;
      const embedded = embeddedThemeFor(theme);
      if (current === embedded) return true;
      await rpc.mutateSettings("ui-theme", [{ op: "set", path: ["preference"], value: embedded }], view.revision);
      return true;
    });
  } catch (error) {
    logger.warn(`theme sync failed: ${error.message}`);
    return false;
  }
}

async function readHarnessTheme() {
  if (!harness || harness.status().state !== "ready") return null;
  try {
    return await harness.withRpc(async rpc => {
      const describe = await rpc.describeSettings();
      const view = (describe.namespaces || []).find(entry => entry.ns === "ui-theme");
      return view && view.value && typeof view.value.preference === "string" ? view.value.preference : null;
    });
  } catch {
    return null;
  }
}

/** Align DeepDeck to an already-fixed harness theme without writing the harness. */
async function alignThemeFromHarness() {
  const preference = await readHarnessTheme();
  if ((preference === "light" || preference === "dark") && prefs.get().theme === "system") {
    prefs.patch({ theme: preference });
    nativeTheme.themeSource = preference;
    viewManager?.reloadChat();
    scheduleState();
  }
}

async function applyTheme(theme) {
  const before = prefs.get().theme;
  prefs.patch({ theme });
  nativeTheme.themeSource = nativeThemeFor(theme);
  // Switching within the same embedded light/dark family (for example Dark to
  // Midnight) should not reload the real chat page or lose a draft.
  if (embeddedThemeFor(before) !== embeddedThemeFor(theme)) viewManager?.reloadChat();
  await syncHarnessTheme(theme);
  scheduleState();
  return prefs.get().theme;
}

function currentRpc(operation) {
  if (updateBusy) throw new Error("The private runtime is being prepared. Try again when Code is ready.");
  return changeHarness(() => harness.withRpc(operation));
}

function registerIpc() {
  ipcMain.handle("app:state", trusted(async () => appState()));
  ipcMain.handle("app:mode:set", trusted(async mode => {
    if (mode !== "chat" && mode !== "code") throw new Error("Invalid mode");
    safelySetMode(mode);
    scheduleState();
    return appState();
  }));
  ipcMain.handle("app:settings:set", trusted(async open => {
    viewManager.setSettings(Boolean(open));
    scheduleState();
    return appState();
  }));
  ipcMain.handle("app:overlay:set", trusted(async open => {
    await viewManager.setOverlay(Boolean(open));
    scheduleState();
    return appState();
  }));
  ipcMain.handle("app:focus:set", trusted(async focus => {
    viewManager.setFocus(Boolean(focus));
    scheduleState();
    return appState();
  }));
  ipcMain.handle("app:pick-directory", trusted(async kind => {
    if (kind && kind !== "workspace") throw new Error("The harness installation is managed privately by DeepDeck");
    const current = prefs.get().harness.workdir;
    const result = await dialog.showOpenDialog(win, {
      title: "Choose the default workspace",
      defaultPath: current && fs.existsSync(current) ? current : undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  }));
  ipcMain.handle("workspace:open-folder", trusted(async () => openWorkspaceFolder()));
  ipcMain.handle("workspace:open-documents", trusted(async () => {
    const documents = path.join(os.homedir(), "Documents");
    const target = fs.existsSync(documents) ? documents : os.homedir();
    const problem = await shell.openPath(target);
    if (problem) throw new Error(problem);
    return true;
  }));
  ipcMain.handle("workspace:copy-path", trusted(async () => {
    copyTextToSystemClipboard(prefs.get().harness.workdir);
    return true;
  }));
  ipcMain.handle("app:open-external", trusted(async value => {
    const external = externalUrl(value);
    if (!external) throw new Error("Only https links can open externally");
    await shell.openExternal(external);
    return true;
  }));
  ipcMain.handle("app:quit", trusted(async () => { app.quit(); return true; }));
  ipcMain.handle("app:prefs:save", trusted(async patch => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid preferences");
    const before = prefs.get();
    if (updateBusy && patch.harness) throw new Error("Wait for the runtime operation to finish before changing the workspace.");
    if (patch.harness && patch.harness.workdir && !fs.existsSync(patch.harness.workdir)) {
      throw new Error(`Workspace not found: ${patch.harness.workdir}`);
    }
    const workdirChanged = Boolean(patch.harness && patch.harness.workdir && patch.harness.workdir !== before.harness.workdir);
    const next = prefs.patch({
      ...patch,
      harness: patch.harness
        ? { ...patch.harness, ...(workdirChanged ? { defaultWorkspaceSelected: false } : {}) }
        : patch.harness,
    });
    if (next.harness.workdir !== before.harness.workdir || next.harness.port !== before.harness.port) {
      if (!fs.existsSync(next.harness.workdir)) throw new Error(`Workspace not found: ${next.harness.workdir}`);
      if (harness) await changeHarness(() => harness.restart());
    }
    applyWorkspacePaths(next);
    if (next.theme !== before.theme) {
      nativeTheme.themeSource = nativeThemeFor(next.theme);
      if (embeddedThemeFor(before.theme) !== embeddedThemeFor(next.theme)) viewManager?.reloadChat();
    }
    broadcast("prefs:changed", next);
    scheduleState();
    return next;
  }));
  ipcMain.handle("app:theme:set", trusted(async theme => {
    if (!THEME_IDS.includes(theme)) throw new Error("Invalid theme");
    return applyTheme(theme);
  }));
  ipcMain.handle("app:zoom:get", trusted(async () => prefs.get().zoom));
  ipcMain.handle("app:zoom:set", trusted(async factor => {
    applyZoom(Number(factor));
    return prefs.get().zoom;
  }));

  ipcMain.handle("window:minimize", trusted(async () => { win?.minimize(); return true; }));
  ipcMain.handle("window:toggle-maximize", trusted(async () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return true;
  }));
  ipcMain.handle("window:close", trusted(async () => { win?.close(); return true; }));
  ipcMain.handle("window:state", trusted(async () => windowState()));

  ipcMain.handle("harness:status", trusted(async () => harness.status()));
  ipcMain.handle("harness:restart", wrap(async () => {
    if (harnessStartup.pending) return harnessStartup.start();
    if (!runtimeManager.current()) return harnessStartup.start({ retry: true });
    const status = await changeHarness(() => harness.restart());
    return status;
  }));
  ipcMain.handle("harness:reload", wrap(async () => {
    viewManager.reload();
    return true;
  }));
  ipcMain.handle("harness:open-log", trusted(async () => {
    const setupLog = runtimeManager?.status().logFile;
    await shell.openPath(setupLog && fs.existsSync(setupLog) ? setupLog : resolvedPaths.harnessLog);
    return true;
  }));
  ipcMain.handle("harness:open-config-folder", trusted(async () => {
    await shell.openPath(resolvedPaths.dataDir);
    return true;
  }));
  ipcMain.handle("usage:show", trusted(async bounds => {
    if (!viewManager) return false;
    return viewManager.showUsage(bounds || {});
  }));
  ipcMain.handle("usage:hide", trusted(async () => {
    viewManager?.hideUsage();
    return true;
  }));
  ipcMain.handle("usage:reload", trusted(async () => viewManager?.reloadUsage() ?? false));
  ipcMain.handle("harness:open-settings", wrap(async section => openHarnessSettings(section)));
  ipcMain.handle("harness:reveal-workspace", wrap(async () => revealHarnessWorkspace()));

  ipcMain.handle("web:status", trusted(async () => webSession.status()));
  ipcMain.handle("web:sign-in-app", wrap(async () => webSession.signInInApp()));
  ipcMain.handle("web:sign-in-chrome", wrap(async () => webSession.beginChromeSignIn()));
  ipcMain.handle("web:focus-chrome", wrap(async () => webSession.focusChrome()));
  ipcMain.handle("web:confirm-chrome", wrap(async accepted => webSession.finishChromeSignIn(accepted === true)));
  ipcMain.handle("web:cancel-sign-in", wrap(async () => webSession.cancelSignIn()));
  ipcMain.handle("web:sign-out", wrap(async () => webSession.signOut()));
  ipcMain.handle("web:grant-directory", wrap(async () => {
    viewManager.setFocus(false);
    viewManager.setSettings(false);
    viewManager.setMode("chat");
    await new Promise(resolve => setTimeout(resolve, 180));
    return grantChatDirectory();
  }));
  ipcMain.handle("webchat:grant-directory", async event => {
    const contents = viewManager?.chatContents();
    if (!contents || event.sender !== contents) throw new Error("Untrusted directory request");
    return grantChatDirectory();
  });
  ipcMain.handle("web:attach-files", trusted(async () => {
    const contents = viewManager?.chatContents();
    if (!contents) throw new Error("DeepSeek chat is still starting. Try again in a moment.");
    viewManager.setFocus(false);
    viewManager.setSettings(false);
    viewManager.setMode("chat");
    await new Promise(resolve => setTimeout(resolve, 180));
    const opened = await contents.executeJavaScript(`(() => {
      const input = document.querySelector('input[type=file]');
      if (!input) return false;
      input.click();
      return true;
    })()`, true);
    if (!opened) throw new Error("DeepSeek's composer is not ready yet. Open Chat and try again.");
    return true;
  }));
  ipcMain.handle("web:reload-chat", trusted(async () => { viewManager.reloadChat(); return true; }));
  ipcMain.handle("webchat:pick-files", async (event, options) => {
    const contents = viewManager?.chatContents();
    if (!contents || event.sender !== contents) {
      return { ok: false, message: "The file picker is only available to DeepSeek chat." };
    }
    try {
      return await pickChatFiles(options && typeof options === "object" ? options : {});
    } catch (error) {
      logger.warn(`chat file picker failed: ${error.message}`);
      return { ok: false, message: redact(error.message) };
    }
  });

  ipcMain.handle("updates:check", wrap(async () => checkUpdates({ fetch: true })));
  ipcMain.handle("updates:apply", wrap(async () => applyUpdates()));
  ipcMain.handle("providers:list", wrap(async () => currentRpc(rpc => loadProviders(rpc))));
  ipcMain.handle("providers:save", wrap(async input => currentRpc(rpc => saveProvider(rpc, input || {}))));
  ipcMain.handle("providers:remove", wrap(async (provider, removeKey) =>
    currentRpc(rpc => removeProvider(rpc, provider, { removeKey: removeKey === true }))));
  ipcMain.handle("providers:set-key", wrap(async input => currentRpc(rpc => setProviderKey(rpc, input || {}))));
  ipcMain.handle("providers:remove-key", wrap(async input => currentRpc(rpc => removeProviderKey(rpc, input || {}))));
  ipcMain.handle("providers:set-default", wrap(async input => currentRpc(rpc => setDefaultModel(rpc, input || {}))));
  ipcMain.handle("providers:discover", wrap(async input => currentRpc(rpc => discoverModels(rpc, input || {}))));

  ipcMain.handle("subagents:list", wrap(async () => currentRpc(rpc => loadSubagents(rpc, { runtime: runtimeManager.current() }))));
  ipcMain.handle("subagents:save", wrap(async input => currentRpc(rpc => saveSubagents(rpc, { ...(input || {}), runtime: runtimeManager.current() }))));
  ipcMain.handle("subagents:install", wrap(async (kind, options) => installSubagent(kind, options || {})));
  ipcMain.handle("subagents:uninstall", wrap(async kind => uninstallSubagent(kind)));
  ipcMain.handle("subagents:create-preset", wrap(async kinds => createPresetFlow(kinds || [])));
  ipcMain.handle("subagents:remove-preset", wrap(async () => removePresetFlow()));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function elementRect(contents, expression) {
  if (!contents) return null;
  try {
    return await contents.executeJavaScript(`(() => {
      const element = ${expression};
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`, true);
  } catch {
    return null;
  }
}

/**
 * The harness client ignores untrusted DOM clicks on its navigation. Dispatch
 * native input at the element's center so the client sees a real user gesture.
 */
async function trustedClick(contents, rect) {
  if (!contents || !rect) return false;
  try { contents.focus(); } catch { /* best effort */ }
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  contents.sendInputEvent({ type: "mouseMove", x, y });
  await delay(60);
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await delay(80);
  return true;
}

async function trustedClickSelector(contents, selector) {
  const rect = await elementRect(contents, `document.querySelector(${JSON.stringify(selector)})`);
  return trustedClick(contents, rect);
}

async function openHarnessSettings(section) {
  const contents = viewManager?.codeContents();
  if (!contents) return { opened: false, reason: "The harness is not ready." };
  viewManager.setMode("code");
  viewManager.setSettings(false);
  await new Promise(resolve => setTimeout(resolve, 250));

  if (section === "plugins") {
    const clicked = await trustedClickSelector(contents, 'button[aria-label="Plugins"]');
    if (clicked) {
      for (let i = 0; i < 30; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
        const opened = await contents.executeJavaScript(
          'document.body.innerText.includes("Install, enable, and configure plugins")',
          true,
        ).catch(() => false);
        if (opened) return { opened: true };
      }
      return { opened: false, reason: "The harness Plugins page did not open." };
    }
  }

  if (section === "models") {
    const clicked = await trustedClickSelector(contents, 'button[aria-label^="Select model"]');
    if (clicked) return { opened: true, picker: true };
    return { opened: false, reason: "Open a session and use the model picker in the composer." };
  }

  if (section === "presets") {
    const rect = await elementRect(contents, `[...document.querySelectorAll('button')].find(button => /^\\s*(Standard|Plan|Agent|DeepDeck)\\b.*mode/i.test(button.textContent || ''))`);
    if (await trustedClick(contents, rect)) return { opened: true, picker: true };
    return { opened: false, reason: "Open a session and use the mode picker in the composer." };
  }

  // Older harness builds exposed a Settings dialog. Keep that fallback for
  // checkouts pinned to an older release.
  const labels = { general: "General" };
  const label = labels[section] || "General";
  const script = `(async () => {
    const visible = element => element && element.getClientRects().length > 0;
    const text = element => (element.textContent || "").trim().replace(/\\s+/g, " ");
    const clickable = () => [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
    let trigger = clickable().find(element => /settings/i.test(element.getAttribute("aria-label") || ""));
    if (!trigger) trigger = clickable().find(element => text(element) === "Settings");
    if (!trigger) return false;
    trigger.click();
    for (let i = 0; i < 40; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
      const item = clickable().find(element => text(element) === ${JSON.stringify(label)})
        || clickable().find(element => text(element).startsWith(${JSON.stringify(label)}));
      if (item) { item.click(); return true; }
    }
    return false;
  })()`;
  try {
    const opened = await contents.executeJavaScript(script, true);
    return { opened: opened !== false };
  } catch (error) {
    return { opened: false, reason: error.message };
  }
}

function workspaceTitleFor(workdir) {
  const fallback = path.basename(workdir);
  try {
    const home = runtimeManager.current()?.home;
    if (!home) return fallback;
    const data = JSON.parse(fs.readFileSync(path.join(home, "storages", "workspace.json"), "utf8"));
    const workspaces = data && data.tables && data.tables.workspaces ? data.tables.workspaces : {};
    const match = Object.values(workspaces).find(workspace => workspace && workspace.path === workdir);
    if (match && typeof match.title === "string" && match.title.trim()) return match.title;
  } catch { /* fall back to the folder name */ }
  return fallback;
}

async function revealHarnessWorkspace() {
  const contents = viewManager?.codeContents();
  if (!contents) return { revealed: false, selected: false, reason: "The harness is not ready." };
  const title = workspaceTitleFor(prefs.get().harness.workdir);
  viewManager.setMode("code");
  viewManager.setSettings(false);
  await delay(250);

  let chip = await elementRect(contents, `document.querySelector('button[aria-label="Choose workspace"]')`);
  if (!chip) {
    chip = await elementRect(contents, `[...document.querySelectorAll('button')].find(button => {
      const text = (button.textContent || "").trim().replace(/\\s+/g, " ");
      const rect = button.getBoundingClientRect();
      return rect.x > 260 && (text === ${JSON.stringify(title)} || text.includes(${JSON.stringify(title)}));
    })`);
  }
  if (!chip) return { revealed: false, selected: false, title, reason: "The workspace picker is not visible. Open a session first." };

  await trustedClick(contents, chip);
  await delay(350);
  const item = await elementRect(contents, `(() => {
    const title = ${JSON.stringify(title)};
    const menu = [...document.querySelectorAll('[role="menu"], [role="listbox"]')]
      .find(element => element.getClientRects().length > 0);
    if (!menu) return null;
    const leaf = [...menu.querySelectorAll("*")]
      .find(element => element.children.length === 0 && (element.textContent || "").trim() === title);
    if (!leaf) return null;
    let node = leaf;
    for (let depth = 0; depth < 6 && node; depth += 1) {
      const role = node.getAttribute && node.getAttribute("role");
      if (node.tagName === "BUTTON" || node.tagName === "LI" || role === "menuitem" || role === "option"
        || (node.hasAttribute && node.hasAttribute("tabindex"))) return node;
      node = node.parentElement;
    }
    return leaf;
  })()`);
  if (!item) return { revealed: true, selected: false, title, reason: "The workspace menu did not show the row." };
  await trustedClick(contents, item);
  await delay(450);
  return { revealed: true, selected: true, title };
}

async function installSubagent(kind, { createPreset = true, setDefault = true } = {}) {
  return changeHarness(async () => {
    broadcast("subagents:progress", { phase: "installing", message: "Installing the backend in DeepDeck's private profile…" });
    const result = await harness.withRpc(rpc => installBackend(rpc, kind));
    if (result.application === "restart-required") await harness.restart();
    if (createPreset) {
      const preset = await harness.withRpc(rpc => createDeepDeckPreset(rpc, { home: runtimeManager.current().home }));
      if (preset.change.application === "restart-required") await harness.restart();
      if (setDefault) await harness.withRpc(rpc => setPresetDefault(rpc, "deepdeck-full"));
    }
    broadcast("subagents:progress", { phase: "done", message: "Backend ready in DeepDeck." });
    return harness.withRpc(rpc => loadSubagents(rpc, { runtime: runtimeManager.current() }));
  });
}
async function uninstallSubagent(kind) {
  return changeHarness(async () => {
    const result = await harness.withRpc(rpc => removeBackend(rpc, kind));
    if (result.application === "restart-required") await harness.restart();
    return harness.withRpc(rpc => loadSubagents(rpc, { runtime: runtimeManager.current() }));
  });
}
async function createPresetFlow() {
  return changeHarness(async () => {
    const preset = await harness.withRpc(rpc => createDeepDeckPreset(rpc, { home: runtimeManager.current().home }));
    if (preset.change.application === "restart-required") await harness.restart();
    await harness.withRpc(rpc => setPresetDefault(rpc, "deepdeck-full"));
    return { preset, subagents: await harness.withRpc(rpc => loadSubagents(rpc, { runtime: runtimeManager.current() })) };
  });
}
async function removePresetFlow() {
  return changeHarness(async () => {
    const result = await harness.withRpc(removeDeepDeckPreset);
    if (result.application === "restart-required") await harness.restart();
    const directory = presetDirectory(runtimeManager.current().home);
    assertOwned(resolvedPaths.harnessRoot, directory);
    fs.rmSync(directory, { recursive: true, force: true });
    return harness.withRpc(rpc => loadSubagents(rpc, { runtime: runtimeManager.current() }));
  });
}

async function cleanup() {
  clearTimeout(updateCheckTimer);
  clearInterval(updateCheckInterval);
  try { await webSession?.cancelSignIn(); } catch { /* best effort */ }
  try { await runtimeManager?.close(); } catch { /* best effort */ }
  try { await harness?.stop(); } catch { /* best effort */ }
  try { viewManager?.destroy(); } catch { /* best effort */ }
  try { await shellServer?.close(); } catch { /* best effort */ }
  logger.info("DeepDeck stopped");
}
