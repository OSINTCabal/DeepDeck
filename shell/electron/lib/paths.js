/**
 * DeepDeck filesystem layout.
 *
 * The app can run from its source checkout or from the installed copy under
 * `~/.local/share/deepdeck`; both keep `shell/electron/lib` three levels below
 * the app root. User state is split across XDG config and data so the Electron
 * profile (cookies, partitions) stays out of logs and state files.
 *
 * This module is pure: every function either computes a path or ensures a
 * directory exists. It never reads application state.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function homeDir() {
  return process.env.HOME || os.homedir();
}

const DEFAULT_WORKDIR = path.join(homeDir(), "Documents", "DeepDeck");

function xdgConfigHome() {
  return process.env.XDG_CONFIG_HOME || path.join(homeDir(), ".config");
}

function xdgDataHome() {
  return process.env.XDG_DATA_HOME || path.join(homeDir(), ".local", "share");
}

/** App root: `DeepDeck/` in both the source checkout and the installed tree. */
function appRoot() {
  if (process.env.DEEPDECK_HOME) return path.resolve(process.env.DEEPDECK_HOME);
  return path.resolve(__dirname, "..", "..", "..");
}

function configDir() {
  return path.join(xdgConfigHome(), "deepdeck");
}

function dataDir() {
  return path.join(xdgDataHome(), "deepdeck");
}

function logsDir() {
  return path.join(dataDir(), "logs");
}

function paths() {
  return {
    appRoot: appRoot(),
    configDir: configDir(),
    configFile: path.join(configDir(), "config.json"),
    dataDir: dataDir(),
    logsDir: logsDir(),
    mainLog: path.join(logsDir(), "main.log"),
    harnessLog: path.join(logsDir(), "harness.log"),
    harnessState: path.join(dataDir(), "harness.json"),
    harnessRoot: path.join(dataDir(), "harness"),
    webProfile: path.join(dataDir(), "web-browser"),
    webMarker: path.join(dataDir(), "web-signed-in.json"),
    webSession: path.join(dataDir(), "web-session.json"),
    electronData: path.join(configDir(), "electron"),
    frontendDist: process.env.DEEPDECK_FRONTEND_DIST
      || path.join(appRoot(), "frontend", "dist"),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort on unusual filesystems */ }
  return dir;
}

function ensureDirs() {
  const p = paths();
  ensureDir(p.configDir);
  ensureDir(p.dataDir);
  ensureDir(p.logsDir);
  ensureDir(p.electronData);
  return p;
}

/** Defaults that make the first launch land in the requested folder. */
function defaultHarness() {
  return {
    workdir: process.env.DEEPDECK_WORKDIR || DEFAULT_WORKDIR,
    port: 9411,
    defaultWorkspaceSelected: false,
  };
}

module.exports = {
  DEFAULT_WORKDIR,
  appRoot,
  configDir,
  dataDir,
  logsDir,
  paths,
  ensureDir,
  ensureDirs,
  defaultHarness,
  xdgConfigHome,
  xdgDataHome,
};
