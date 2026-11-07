/**
 * Owns the two embedded WebContentsViews.
 *
 * Both applications are loaded top-level: the DeepSeek chat site rejects an
 * iframe's opaque-origin API calls, and the harness's cookie is SameSite=Strict.
 * Views are kept alive across mode switches so drafts and scroll positions
 * survive, and are hidden while the native Settings surface is open.
 */

const { WebContentsView } = require("electron");
const path = require("node:path");
const { isChatNavigationHost, isGoogleAuthHost, isDeepSeekHost, externalUrl } = require("./security");

const { waitForCodePage, codeWebPreferences } = require("./harness-page");

const BAR_HEIGHT = 40;

function createViewManager({
  getWindow,
  getPreferences,
  chatSession,
  codeSession,
  usageSession,
  chatPreload,
  codePreload,
  logger,
  onState,
  onGoogleAuth,
}) {
  let chatView = null;
  let codeView = null;
  let codeUrl = null;
  let codeLoadAbort = null;
  let mode = "chat";
  let settingsOpen = false;
  let overlayOpen = false;
  let focusMode = false;
  let chatStatus = { state: "idle", detail: "" };
  let codeStatus = { state: "idle", detail: "" };
  let lastZoom = 1;
  let overlayBackdrop = null;
  let usageView = null;
  let usageVisible = false;
  let usageBounds = null;
  let usageStatus = { state: "idle", detail: "" };

  const publish = () => {
    layout();
    onState?.({
      mode,
      settingsOpen,
      overlayOpen,
      backdrop: overlayBackdrop,
      focusMode,
      chat: chatStatus,
      code: codeStatus,
      usage: usageStatus,
      zoom: lastZoom,
    });
  };

  function bounds() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
    const [width, height] = win.getContentSize();
    const zoom = win.webContents.getZoomFactor() || lastZoom;
    const top = focusMode ? 0 : Math.round(BAR_HEIGHT * zoom);
    return { x: 0, y: top, width: Math.max(0, width), height: Math.max(0, height - top) };
  }

  function layout() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const rectangle = bounds();
    for (const view of [chatView, codeView]) {
      if (!view) continue;
      view.setBounds(rectangle);
    }
    const showUsage = Boolean(usageVisible && settingsOpen && !overlayOpen && !focusMode && usageView);
    if (usageView) {
      if (usageBounds) usageView.setBounds(usageBounds);
      usageView.setVisible(showUsage);
    }
    const hidden = settingsOpen || overlayOpen || usageVisible;
    const showChat = !hidden && mode === "chat" && chatView;
    const showCode = !hidden && mode === "code" && codeView && codeStatus.state === "ready";
    if (chatView) chatView.setVisible(Boolean(showChat));
    if (codeView) codeView.setVisible(Boolean(showCode));
  }

  function attach(view) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.contentView.addChildView(view);
    view.setBounds(bounds());
    view.setVisible(false);
  }

  function detach(view) {
    const win = getWindow();
    if (!view) return;
    if (win && !win.isDestroyed()) {
      try { win.contentView.removeChildView(view); } catch { /* already detached */ }
    }
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  }

  function wireNavigation(contents, kind) {
    const googleRedirect = url => {
      let parsed;
      try { parsed = new URL(url); } catch { return false; }
      if (kind !== "chat" || !isGoogleAuthHost(parsed.hostname)) return false;
      // Google refuses OAuth in Electron user agents. Do not show its dead-end
      // error page: hand the same intent to the real-Chrome flow instead.
      void contents.loadURL("https://chat.deepseek.com/sign_in").catch(() => {});
      onGoogleAuth?.();
      return true;
    };
    contents.setWindowOpenHandler(({ url }) => {
      if (googleRedirect(url)) return { action: "deny" };
      const external = externalUrl(url);
      if (kind === "usage") {
        try {
          const parsed = new URL(url);
          if (isDeepSeekHost(parsed.hostname)) {
            void contents.loadURL(url).catch(() => {});
            return { action: "deny" };
          }
        } catch { /* fall through */ }
      }
      if (kind === "chat") {
        try {
          const parsed = new URL(url);
          if (isChatNavigationHost(parsed.hostname)) {
            void contents.loadURL(url).catch(() => {});
            return { action: "deny" };
          }
        } catch { /* fall through */ }
      }
      if (external) void require("electron").shell.openExternal(external);
      return { action: "deny" };
    });
    const navigate = (event, url) => {
      let parsed;
      try { parsed = new URL(url); } catch { event.preventDefault(); return; }
      if (kind === "chat" && isGoogleAuthHost(parsed.hostname)) {
        event.preventDefault();
        googleRedirect(url);
        return;
      }
      if (kind === "usage" && isDeepSeekHost(parsed.hostname)) return;
      if (kind === "chat") {
        if (isChatNavigationHost(parsed.hostname)) return;
      } else if (codeUrl) {
        try {
          if (parsed.origin === new URL(codeUrl).origin) return;
        } catch { /* fall through */ }
      }
      event.preventDefault();
      const external = externalUrl(url);
      if (external) void require("electron").shell.openExternal(external);
    };
    contents.on("will-navigate", navigate);
    contents.on("will-redirect", navigate);
  }

  function createChat() {
    if (chatView) return chatView;
    chatStatus = { state: "loading", detail: "" };
    publish();
    const view = new WebContentsView({
      webPreferences: {
        session: chatSession,
        preload: chatPreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
      },
    });
    view.setBackgroundColor("#ffffff");
    chatView = view;
    const contents = view.webContents;
    wireNavigation(contents, "chat");
    contents.on("did-finish-load", () => {
      chatStatus = { state: "ready", detail: "" };
      const directory = getPreferences?.()?.web?.chatDirectory;
      if (directory) contents.send("webchat:directory", { name: path.basename(directory) });
      publish();
    });
    contents.on("did-fail-load", (_event, code, description) => {
      if (code === -3) return;
      chatStatus = { state: "error", detail: description || `Load failed (${code})` };
      publish();
    });
    contents.on("render-process-gone", () => {
      chatStatus = { state: "error", detail: "The chat page stopped. Reload to continue." };
      publish();
    });
    contents.on("page-title-updated", event => event.preventDefault());
    attach(view);
    void contents.loadURL("https://chat.deepseek.com/").catch(error => {
      logger?.warn(`chat load failed: ${error.message}`);
    });
    layout();
    return view;
  }

  function destroyCode() {
    if (!codeView) return;
    codeLoadAbort?.abort();
    codeLoadAbort = null;
    detach(codeView);
    codeView = null;
    codeUrl = null;
    codeStatus = { state: "idle", detail: "" };
    publish();
  }

  function createCode(url) {
    if (codeView && codeUrl === url) {
      layout();
      return codeView;
    }
    destroyCode();
    codeUrl = url;
    codeStatus = { state: "loading", detail: "" };
    publish();
    const view = new WebContentsView({
      webPreferences: codeWebPreferences({ session: codeSession, preload: codePreload }),
    });
    view.setBackgroundColor("#f6f7f9");
    codeView = view;
    const contents = view.webContents;
    wireNavigation(contents, "code");
    contents.on("did-start-loading", () => {
      codeLoadAbort?.abort();
      codeLoadAbort = null;
      codeStatus = { state: "loading", detail: "Loading harness interface…" };
      publish();
    });
    contents.on("did-finish-load", () => {
      codeLoadAbort?.abort();
      const controller = codeLoadAbort = new AbortController();
      codeStatus = { state: "loading", detail: "Loading harness plugins…" };
      publish();
      void waitForCodePage(contents, { signal: controller.signal }).then(() => {
        if (codeView !== view || codeLoadAbort !== controller) return;
        codeStatus = { state: "ready", detail: "" };
        publish();
      }).catch(error => {
        if (codeView !== view || codeLoadAbort !== controller || contents.isDestroyed()) return;
        codeStatus = { state: "error", detail: error.message };
        publish();
      });
    });
    contents.on("did-fail-load", (_event, code, description) => {
      if (code === -3) return;
      codeLoadAbort?.abort();
      codeLoadAbort = null;
      codeStatus = { state: "error", detail: description || `Load failed (${code})` };
      publish();
    });
    contents.on("render-process-gone", () => {
      codeLoadAbort?.abort();
      codeLoadAbort = null;
      codeStatus = { state: "error", detail: "The harness page stopped. Reload to continue." };
      publish();
    });
    contents.on("page-title-updated", event => event.preventDefault());
    attach(view);
    void contents.loadURL(url).catch(error => logger?.warn(`harness view load failed: ${error.message}`));
    layout();
    return view;
  }

  async function resetCodeCache() {
    destroyCode();
    await codeSession.clearCache();
  }

  function ensureUsageView() {
    if (usageView) return usageView;
    usageStatus = { state: "loading", detail: "" };
    publish();
    const view = new WebContentsView({
      webPreferences: {
        session: usageSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
      },
    });
    usageView = view;
    view.setBackgroundColor("#ffffff");
    const contents = view.webContents;
    wireNavigation(contents, "usage");
    contents.on("did-finish-load", () => {
      usageStatus = { state: "ready", detail: "" };
      publish();
    });
    contents.on("did-fail-load", (_event, code, description) => {
      if (code === -3) return;
      usageStatus = { state: "error", detail: description || `Usage page load failed (${code})` };
      publish();
    });
    contents.on("render-process-gone", () => {
      usageStatus = { state: "error", detail: "The usage dashboard stopped. Reload to continue." };
      publish();
    });
    contents.on("page-title-updated", event => event.preventDefault());
    attach(view);
    void contents.loadURL("https://platform.deepseek.com/usage").catch(error => {
      usageStatus = { state: "error", detail: error.message };
      logger?.warn(`usage view load failed: ${error.message}`);
      publish();
    });
    return view;
  }

  function showUsage(rect) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    const zoom = win.webContents.getZoomFactor() || lastZoom || 1;
    const [width, height] = win.getContentSize();
    const x = Math.max(0, Math.round((rect?.x || 0) * zoom));
    const y = Math.max(0, Math.round((rect?.y || 0) * zoom));
    const w = Math.max(1, Math.min(width - x, Math.round((rect?.width || width) * zoom)));
    const h = Math.max(1, Math.min(height - y, Math.round((rect?.height || height) * zoom)));
    usageBounds = { x, y, width: w, height: h };
    usageVisible = true;
    ensureUsageView();
    layout();
    usageView?.webContents.focus();
    publish();
    return true;
  }

  function hideUsage() {
    usageVisible = false;
    layout();
    publish();
  }

  function reloadUsage() {
    if (!usageView) return false;
    usageView.webContents.reload();
    return true;
  }

  function usageContents() {
    return usageView?.webContents || null;
  }

  function setMode(next) {
    if (next !== "chat" && next !== "code") throw new Error("Invalid mode");
    mode = next;
    layout();
    const active = mode === "chat" ? chatView : codeView;
    if (active) active.webContents.focus();
    publish();
  }

  function setSettings(open) {
    settingsOpen = Boolean(open);
    if (settingsOpen) {
      focusMode = false;
      overlayBackdrop = null;
    } else {
      usageVisible = false;
    }
    layout();
    if (!settingsOpen && getWindow()) getWindow().webContents.focus();
    publish();
  }

  async function captureBackdrop() {
    const view = mode === "chat" ? chatView : codeView;
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      const image = await view.webContents.capturePage();
      if (!image || image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(58).toString("base64")}`;
    } catch {
      return null;
    }
  }

  async function setOverlay(open) {
    const next = Boolean(open);
    if (next && !overlayOpen) {
      const image = await captureBackdrop();
      overlayBackdrop = image;
    }
    overlayOpen = next;
    if (!overlayOpen) overlayBackdrop = null;
    layout();
    if (!overlayOpen && getWindow()) getWindow().webContents.focus();
    publish();
  }

  function setFocus(next) {
    focusMode = Boolean(next);
    if (focusMode) {
      settingsOpen = false;
      usageVisible = false;
    }
    layout();
    publish();
  }

  function reload() {
    const view = mode === "chat" ? chatView : codeView;
    if (view) view.webContents.reload();
  }

  function reloadChat() {
    if (chatView) chatView.webContents.reload();
  }

  function setZoom(factor) {
    lastZoom = factor;
    if (chatView) chatView.webContents.setZoomFactor(factor);
    if (codeView) codeView.webContents.setZoomFactor(factor);
    layout();
  }

  function activeContents() {
    return (mode === "chat" ? chatView : codeView)?.webContents || null;
  }

  function codeContents() {
    return codeView?.webContents || null;
  }

  function chatContents() {
    return chatView?.webContents || null;
  }

  function destroy() {
    overlayBackdrop = null;
    detach(chatView);
    chatView = null;
    destroyCode();
    detach(usageView);
    usageView = null;
    usageVisible = false;
  }

  function state() {
    return {
      mode,
      settingsOpen,
      overlayOpen,
      backdrop: overlayBackdrop,
      focusMode,
      chat: chatStatus,
      code: codeStatus,
      usage: usageStatus,
      zoom: lastZoom,
      hasChat: Boolean(chatView),
      hasCode: Boolean(codeView),
    };
  }

  return {
    BAR_HEIGHT,
    createChat,
    createCode,
    resetCodeCache,
    destroyCode,
    setMode,
    setSettings,
    setOverlay,
    setFocus,
    reload,
    reloadChat,
    setZoom,
    activeContents,
    codeContents,
    chatContents,
    usageContents,
    showUsage,
    hideUsage,
    reloadUsage,
    chatView: () => chatView,
    codeView: () => codeView,
    layout,
    destroy,
    state,
    bounds,
  };
}

module.exports = { createViewManager, BAR_HEIGHT };
