// DeepDeck shell bridge. Only the shell document gets this surface; embedded
// applications never receive it. Every call is validated again in main.

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("deepdeck", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getState: () => invoke("app:state"),
  onState: callback => subscribe("state:changed", callback),
  setMode: mode => invoke("app:mode:set", mode),
  setSettings: open => invoke("app:settings:set", open),
  setOverlay: open => invoke("app:overlay:set", open),
  setFocus: focus => invoke("app:focus:set", focus),
  setTheme: theme => invoke("app:theme:set", theme),
  pickDirectory: kind => invoke("app:pick-directory", kind),
  openExternal: url => invoke("app:open-external", url),
  quit: () => invoke("app:quit"),
  savePreferences: patch => invoke("app:prefs:save", patch),
  onCommand: callback => subscribe("app:command", callback),

  workspace: {
    openFolder: () => invoke("workspace:open-folder"),
    openDocuments: () => invoke("workspace:open-documents"),
    copyPath: () => invoke("workspace:copy-path"),
  },

  window: {
    minimize: () => invoke("window:minimize"),
    toggleMaximize: () => invoke("window:toggle-maximize"),
    close: () => invoke("window:close"),
    getState: () => invoke("window:state"),
    onState: callback => subscribe("window:state", callback),
  },
  zoom: {
    get: () => invoke("app:zoom:get"),
    set: factor => invoke("app:zoom:set", factor),
  },

  harness: {
    status: () => invoke("harness:status"),
    restart: () => invoke("harness:restart"),
    reload: () => invoke("harness:reload"),
    openLog: () => invoke("harness:open-log"),
    openConfigFolder: () => invoke("harness:open-config-folder"),
    openSettings: section => invoke("harness:open-settings", section),
    revealWorkspace: () => invoke("harness:reveal-workspace"),
    onState: callback => subscribe("harness:state", callback),
  },

  updates: {
    check: () => invoke("updates:check"),
    apply: () => invoke("updates:apply"),
  },

  usage: {
    show: bounds => invoke("usage:show", bounds),
    hide: () => invoke("usage:hide"),
    reload: () => invoke("usage:reload"),
  },

  web: {
    status: () => invoke("web:status"),
    signInInApp: () => invoke("web:sign-in-app"),
    beginChromeSignIn: () => invoke("web:sign-in-chrome"),
    focusChrome: () => invoke("web:focus-chrome"),
    confirmChromeSignIn: accepted => invoke("web:confirm-chrome", accepted),
    cancelSignIn: () => invoke("web:cancel-sign-in"),
    signOut: () => invoke("web:sign-out"),
    reloadChat: () => invoke("web:reload-chat"),
    attachFiles: () => invoke("web:attach-files"),
    grantDirectory: () => invoke("web:grant-directory"),
    onState: callback => subscribe("web:state", callback),
  },

  providers: {
    list: () => invoke("providers:list"),
    save: input => invoke("providers:save", input),
    remove: (provider, removeKey) => invoke("providers:remove", provider, removeKey),
    setKey: input => invoke("providers:set-key", input),
    removeKey: input => invoke("providers:remove-key", input),
    setDefault: input => invoke("providers:set-default", input),
    discover: input => invoke("providers:discover", input),
  },

  subagents: {
    list: () => invoke("subagents:list"),
    save: input => invoke("subagents:save", input),
    install: (kind, options) => invoke("subagents:install", kind, options),
    uninstall: kind => invoke("subagents:uninstall", kind),
    createPreset: kinds => invoke("subagents:create-preset", kinds),
    removePreset: () => invoke("subagents:remove-preset"),
    onProgress: callback => subscribe("subagents:progress", callback),
  },
});
