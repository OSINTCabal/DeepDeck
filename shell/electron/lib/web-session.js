/**
 * DeepSeek web account state and sign-in orchestration.
 *
 * The chat view owns a persistent Electron partition. This module keeps the
 * signed-in marker, normalizes browser headers for Google, denies remote
 * permissions except same-origin clipboard writes, runs the in-app auth window,
 * and coordinates the Chrome fallback import. It never exposes a credential to
 * the shell renderer.
 */

const fs = require("node:fs");
const path = require("node:path");
const { shell, Notification } = require("electron");
const { chromeUserAgent, isChatNavigationHost, isGoogleAuthHost, externalUrl, redact } = require("./security");
const { SIGNED_IN_EXPRESSION } = require("./deepseek-session");
const {
  createChromeSession,
  electronCookie,
  filterCookies,
  findChrome,
  removeProfile,
} = require("./chrome-import");

const SIGN_IN_URL = "https://chat.deepseek.com/sign_in";
const HOME_URL = "https://chat.deepseek.com/";
const CHAT_ORIGIN = "https://chat.deepseek.com";
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

function readMarker(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeMarker(file, value) {
  try {
    fs.mkdirSync(require("node:path").dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch { /* marker is advisory; cookies are the truth */ }
}

function removeMarker(file) {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function readSnapshotFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

function writeSnapshotFile(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } catch { /* persistence is best-effort; the marker remains authoritative */ }
}

function removeSnapshotFile(file) {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function createWebSession({
  partition,
  markerFile,
  sessionFile,
  profileDir,
  userAgent,
  logger,
  getWindow,
  getChatContents,
  reloadChat,
  notify,
}) {
  let authWindow = null;
  let chromeSession = null;
  let chromeWatch = null;
  let chromeProbing = false;
  let chromeFinishing = false;
  let minimizeTimer = null;
  let phase = "idle";
  let detail = "";
  let seedStorage = null;
  let marker = readMarker(markerFile);
  const emitter = { callback: null };
  let probeCache = { at: 0, signedIn: null };
  let lastSnapshotAt = 0;
  const createdAt = Date.now();

  const ua = userAgent || chromeUserAgent(process.versions.chrome);
  partition.setUserAgent(ua);

  // Normalize the request UA on Google and DeepSeek hosts. The default Electron
  // UA leaks an Electron/x.y token that Google rejects during OAuth.
  partition.webRequest.onBeforeSendHeaders((details, callback) => {
    let host = "";
    try { host = new URL(details.url).hostname; } catch { /* malformed */ }
    if (isGoogleAuthHost(host) || host.endsWith("deepseek.com")) {
      details.requestHeaders["User-Agent"] = ua;
      const chUa = details.requestHeaders["sec-ch-ua"];
      if (typeof chUa === "string" && chUa.includes("Electron")) {
        details.requestHeaders["sec-ch-ua"] = chUa.replace(/,\s*"Electron";v="[^"]*"/g, "");
      }
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // The remote page gets exactly one permission: a sanitized clipboard write
  // for its own copy buttons. Camera, microphone, geolocation, notifications,
  // fullscreen, clipboard reads, file-system access, and display capture are
  // denied without a site-triggered OS dialog. There is deliberately no cached
  // "granted" set: every launch starts from the same deny-by-default policy.
  const allowedPermissions = new Set(["clipboard-sanitized-write"]);
  const deniedPermissions = new Set();
  const chatOrigin = value => {
    try {
      return new URL(value).origin === CHAT_ORIGIN;
    } catch {
      return false;
    }
  };

  partition.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    const origin = requestingOrigin
      || (contents && typeof contents.getURL === "function" ? contents.getURL() : "");
    return allowedPermissions.has(permission) && chatOrigin(origin);
  });

  partition.setPermissionRequestHandler((contents, permission, callback) => {
    const origin = contents && typeof contents.getURL === "function" ? contents.getURL() : "";
    const allowed = allowedPermissions.has(permission) && chatOrigin(origin);
    if (!allowed && !deniedPermissions.has(permission)) {
      deniedPermissions.add(permission);
      logger?.warn(`chat: denied ${permission}`);
    }
    callback(allowed);
  });

  function emit() {
    void status().then(value => emitter.callback?.(value)).catch(() => {});
  }

  async function cookiesForChat() {
    const results = await Promise.all([
      partition.cookies.get({ domain: "deepseek.com" }).catch(() => []),
      partition.cookies.get({ domain: ".deepseek.com" }).catch(() => []),
      partition.cookies.get({ url: HOME_URL }).catch(() => []),
      partition.cookies.get({ url: SIGN_IN_URL }).catch(() => []),
    ]);
    const flat = results.flat();
    const seen = new Set();
    return flat.filter(cookie => {
      const key = `${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !/^(?:aws[-_]?waf|awswaf)/i.test(cookie.name);
    });
  }

  function snapshotCookie(cookie) {
    const domain = String(cookie.domain || "").replace(/^\./, "");
    if (!domain) return null;
    const cookiePath = cookie.path || "/";
    const detail = {
      url: `https://${domain}${cookiePath}`,
      name: cookie.name,
      value: cookie.value,
      path: cookiePath,
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: cookie.sameSite || "unspecified",
      expirationDate: typeof cookie.expirationDate === "number" && cookie.expirationDate > 0
        ? cookie.expirationDate
        : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };
    if (String(cookie.domain).startsWith(".")) detail.domain = cookie.domain;
    return detail;
  }

  async function captureSnapshot(method, force = false) {
    if (!marker || !sessionFile) return;
    if (!force && Date.now() - lastSnapshotAt < 30_000) return;
    let items = seedStorage ? { ...seedStorage.items } : {};
    const contents = getChatContents?.();
    if (contents && !contents.isDestroyed()) {
      try {
        items = await contents.executeJavaScript(`(() => {
          const out = {};
          for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (!key || /^(?:aws[-_]?waf|awswaf)/i.test(key)) continue;
            out[key] = localStorage.getItem(key);
          }
          return out;
        })()`, true);
      } catch { /* keep the last known values */ }
    }
    const cookies = (await cookiesForChat()).map(snapshotCookie).filter(Boolean);
    writeSnapshotFile(sessionFile, {
      version: 1,
      signedInAt: marker.signedInAt,
      method: marker.method || method,
      cookies,
      localStorage: items,
    });
    lastSnapshotAt = Date.now();
  }

  async function restore() {
    if (!sessionFile) return false;
    const snapshot = readSnapshotFile(sessionFile);
    if (!snapshot) return false;
    for (const cookie of Array.isArray(snapshot.cookies) ? snapshot.cookies : []) {
      try { await partition.cookies.set(cookie); } catch { /* skip one malformed cookie */ }
    }
    try { await partition.cookies.flushStore(); } catch { /* best effort */ }
    seedStorage = {
      origin: CHAT_ORIGIN,
      items: snapshot.localStorage && typeof snapshot.localStorage === "object" ? snapshot.localStorage : {},
    };
    marker = {
      signedInAt: typeof snapshot.signedInAt === "string" ? snapshot.signedInAt : new Date().toISOString(),
      method: typeof snapshot.method === "string" ? snapshot.method : "restored",
    };
    writeMarker(markerFile, marker);
    probeCache = { at: 0, signedIn: null };
    return true;
  }

  async function detectSignedIn(contents, attempts = 1) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await contents.executeJavaScript(SIGNED_IN_EXPRESSION, true);
        if (result && result.signedIn === true) return true;
        if (result && result.reason === "request-failed") return false;
      } catch { /* keep trying briefly */ }
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 350));
    }
    return false;
  }

  async function probeChat() {
    if (!marker) return false;
    if (Date.now() - createdAt < 5000) return true;
    if (Date.now() - probeCache.at < 4000) return probeCache.signedIn !== false;
    const contents = getChatContents?.();
    if (!contents || contents.isDestroyed()) return true;
    let url = "";
    try { url = contents.getURL(); } catch { return true; }
    if (!url || url === "about:blank") return true;
    try { if (contents.isLoading()) return true; } catch { /* keep going */ }
    // Give the site a moment after a sign-in reload before judging it.
    const age = Date.now() - Date.parse(marker.signedInAt || 0);
    if (Number.isFinite(age) && age < 3000) return true;
    try {
      const signedIn = await detectSignedIn(contents, 3);
      probeCache = { at: Date.now(), signedIn };
      if (!signedIn) {
        marker = null;
        removeMarker(markerFile);
        removeSnapshotFile(sessionFile);
        return false;
      }
      void captureSnapshot("probe");
      return true;
    } catch {
      return true;
    }
  }

  async function status() {
    const cookies = await cookiesForChat();
    if (marker && cookies.length === 0) {
      marker = null;
      removeMarker(markerFile);
    }
    if (marker) await probeChat();
    return {
      signedIn: Boolean(marker && cookies.length > 0),
      method: marker ? marker.method || null : null,
      signedInAt: marker ? marker.signedInAt || null : null,
      cookieCount: cookies.length,
      busy: phase !== "idle",
      phase,
      detail,
      chromeAvailable: Boolean(findChrome()),
    };
  }

  async function minimizeForChrome() {
    minimizeTimer = null;
    // Raise Chrome first. Only hide DeepDeck once Chrome is actually in front,
    // so a failed focus cannot leave the user looking at an empty desktop.
    const focused = await chromeSession?.focus?.().catch(() => false);
    if (!focused) return;
    try { getWindow()?.minimize?.(); } catch { /* window may be gone */ }
  }

  /** User-requested "Show Chrome": surface the sign-in window again. */
  async function focusChrome() {
    if (phase !== "waiting-chrome" || !chromeSession) return status();
    const focused = await chromeSession.focus().catch(() => false);
    if (!focused) {
      restoreApp();
      detail = "Chrome is no longer open. Choose Cancel, then start the Chrome sign-in again.";
      emit();
      return status();
    }
    try { getWindow()?.minimize?.(); } catch { /* best effort */ }
    return status();
  }

  function cancelMinimize() {
    if (minimizeTimer) {
      clearTimeout(minimizeTimer);
      minimizeTimer = null;
    }
  }

  function restoreApp() {
    try {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch { /* focus is best-effort */ }
  }

  function stopChromeWatch() {
    if (chromeWatch) {
      clearInterval(chromeWatch);
      chromeWatch = null;
    }
  }

  function startChromeWatch() {
    stopChromeWatch();
    chromeWatch = setInterval(async () => {
      // A DeepSeek session check can take a second or more; never let probes
      // stack up on the same Chrome tab.
      if (chromeProbing || phase !== "waiting-chrome" || !chromeSession) return;
      chromeProbing = true;
      try {
        if (await chromeSession.probe()) {
          stopChromeWatch();
          await finishChromeSignIn(true);
          return;
        }
        if (!(await chromeSession.alive())) {
          // The user closed Chrome. Try the saved profile once, then restore
          // the app with either a signed-in result or an actionable error.
          stopChromeWatch();
          await finishChromeSignIn(true);
          if (phase !== "waiting-chrome") restoreApp();
        }
      } catch { /* keep waiting */ } finally {
        chromeProbing = false;
      }
    }, 2200);
  }

  function setPhase(next, message = "") {
    phase = next;
    detail = message;
    emit();
  }

  function closeAuthWindow() {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    authWindow = null;
  }

  /**
   * Open a top-level auth window on the same partition. Resolves immediately;
   * completion is reported through the state callback.
   */
  async function signInInApp() {
    if (phase !== "idle") return status();
    closeAuthWindow();
    const { BrowserWindow } = require("electron");
    const parent = getWindow();
    setPhase("in-app", "");
    let sawAuth = false;
    let settled = false;

    const win = new BrowserWindow({
      width: 560,
      height: 760,
      parent: parent || undefined,
      modal: false,
      show: true,
      title: "Sign in to DeepSeek",
      backgroundColor: "#ffffff",
      webPreferences: {
        session: partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    authWindow = win;
    win.setMenuBarVisibility(false);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        closeAuthWindow();
        setPhase("error", "The sign-in window timed out. Try again, or use the Chrome fallback.");
      }
    }, AUTH_TIMEOUT_MS);
    timeout.unref?.();

    const finish = async success => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (success) {
        await new Promise(resolve => setTimeout(resolve, 450));
        const signedIn = await detectSignedIn(win.webContents, 10);
        if (!signedIn) {
          setPhase("in-app", "");
          return;
        }
        marker = { signedInAt: new Date().toISOString(), method: "google" };
        writeMarker(markerFile, marker);
        probeCache = { at: Date.now(), signedIn: true };
        setPhase("idle", "Signed in to DeepSeek web.");
        closeAuthWindow();
        reloadChat?.();
      } else {
        setPhase("idle", "");
        closeAuthWindow();
      }
    };

    win.on("closed", () => {
      authWindow = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setPhase("idle", "");
      }
    });

    const navigation = (event, url) => {
      let parsed;
      try { parsed = new URL(url); } catch { event.preventDefault(); return; }
      if (isGoogleAuthHost(parsed.hostname)) {
        event.preventDefault();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
        }
        void switchToChrome();
        return;
      }
      if (!isChatNavigationHost(parsed.hostname)) {
        event.preventDefault();
        const external = externalUrl(url);
        if (external) void shell.openExternal(external);
        return;
      }
      if (parsed.hostname.endsWith("google.com") || parsed.hostname === "login.deepseek.com"
        || parsed.pathname.includes("/login")) {
        sawAuth = true;
      }
      if (parsed.hostname.endsWith("deepseek.com") && sawAuth
        && !parsed.pathname.includes("sign_in") && !parsed.pathname.includes("login")) {
        void finish(true);
      }
    };
    win.webContents.on("will-navigate", navigation);
    win.webContents.on("will-redirect", navigation);
    win.webContents.setWindowOpenHandler(({ url }) => {
      let parsed;
      try { parsed = new URL(url); } catch { return { action: "deny" }; }
      if (isGoogleAuthHost(parsed.hostname)) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
        }
        void switchToChrome();
        return { action: "deny" };
      }
      if (isChatNavigationHost(parsed.hostname)) {
        void win.loadURL(url).catch(() => {});
        return { action: "deny" };
      }
      const external = externalUrl(url);
      if (external) void shell.openExternal(external);
      return { action: "deny" };
    });
    win.webContents.on("did-navigate", (_event, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname.endsWith("deepseek.com") && sawAuth
          && !parsed.pathname.includes("sign_in") && !parsed.pathname.includes("login")) {
          void finish(true);
        }
      } catch { /* ignore */ }
    });
    win.webContents.on("did-fail-load", (_event, code) => {
      if (code !== -3) setPhase("in-app", "The sign-in page could not load. Check your connection and try again.");
    });
    win.webContents.on("did-finish-load", async () => {
      if (settled) return;
      try {
        const host = new URL(win.webContents.getURL()).hostname;
        if (!isGoogleAuthHost(host)) return;
        const body = await win.webContents.executeJavaScript("document.body.innerText", true);
        if (/couldn.t sign you in|may not be secure|disallowed_useragent/i.test(String(body || ""))) {
          if (!settled) { settled = true; clearTimeout(timeout); }
          void switchToChrome();
        }
      } catch { /* the window may be closing */ }
    });

    try {
      await win.loadURL(SIGN_IN_URL);
    } catch (error) {
      logger?.warn(`in-app sign-in load failed: ${error.message}`);
    }
    return status();
  }

  /** Start the real-Chrome fallback and wait for the shell's confirmation. */
  async function switchToChrome() {
    stopChromeWatch();
    closeAuthWindow();
    // Let the auth window's `closed` handler settle before moving to the
    // Chrome-wait phase; otherwise that handler can reset the phase.
    await new Promise(resolve => setTimeout(resolve, 80));
    phase = "idle";
    detail = "";
    if (chromeSession) return status();
    return beginChromeSignIn();
  }

  async function beginChromeSignIn() {
    if (phase !== "idle" && phase !== "error") return status();
    closeAuthWindow();
    if (!findChrome()) {
      setPhase("error", "Install Google Chrome or Chromium to use the Chrome fallback.");
      return status();
    }
    if (chromeSession) {
      try { await chromeSession.shutdown(); } catch { /* already gone */ }
      chromeSession = null;
    }
    chromeSession = createChromeSession({ profileDir, logger });
    try {
      await chromeSession.start();
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: "DeepSeek sign-in in Chrome",
            body: "Finish Google sign-in in Chrome. DeepDeck will detect it and return automatically with your Chat.",
          }).show();
        }
      } catch { /* notifications are optional */ }
      cancelMinimize();
      minimizeTimer = setTimeout(minimizeForChrome, 900);
      setPhase("waiting-chrome", "");
      startChromeWatch();
    } catch (error) {
      stopChromeWatch();
      chromeSession = null;
      setPhase("error", error.message);
    }
    return status();
  }

  async function finishChromeSignIn(accepted) {
    stopChromeWatch();
    cancelMinimize();
    if (chromeFinishing) return status();
    chromeFinishing = true;
    try {
      return await finishChromeSignInInner(accepted);
    } finally {
      chromeFinishing = false;
    }
  }

  async function finishChromeSignInInner(accepted) {
    if (!chromeSession) return status();
    if (accepted === false) {
      await chromeSession.shutdown();
      chromeSession = null;
      await removeProfile(profileDir);
      setPhase("idle", "");
      restoreApp();
      return status();
    }
    setPhase("importing", "Reading the DeepSeek session from Chrome…");
    try {
      const snapshot = await chromeSession.readSnapshot();
      chromeSession = null;
      await importSnapshot(snapshot);
      await removeProfile(profileDir);
      setPhase("idle", "Signed in to DeepSeek web.");
      restoreApp();
    } catch (error) {
      logger?.warn(`Chrome sign-in import failed: ${error.message}`);
      const stillOpen = Boolean(chromeSession && chromeSession.isOpen());
      if (stillOpen) {
        setPhase("waiting-chrome", error.message);
        startChromeWatch();
        return status();
      }
      try { await chromeSession?.shutdown(); } catch { /* gone */ }
      chromeSession = null;
      // Keep the profile on failure so the user can retry with the same signed-in
      // Chrome session; sign-out/cancel removes it.
      setPhase("error", error.message || "The DeepSeek session could not be imported.");
      restoreApp();
    }
    return status();
  }

  async function verifyImportedInChat(timeoutMs = 22000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const contents = getChatContents?.();
      if (contents && !contents.isDestroyed()) {
        let loading = false;
        try { loading = contents.isLoading(); } catch { loading = false; }
        let href = "";
        try { href = contents.getURL(); } catch { href = ""; }
        if (!loading && href.startsWith("https://chat.deepseek.com")) {
          const signedIn = await detectSignedIn(contents, 1);
          if (signedIn) return true;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  async function importSnapshot(snapshot) {
    const cookies = filterCookies(snapshot.cookies || []);
    if (cookies.length === 0) {
      throw new Error("Chrome did not expose a DeepSeek session cookie. Finish signing in, then try again.");
    }
    for (const cookie of cookies) {
      const detailValue = electronCookie(cookie);
      if (!detailValue) continue;
      try {
        await partition.cookies.set(detailValue);
      } catch (error) {
        logger?.warn(`cookie import skipped ${cookie.name}: ${error.message}`);
      }
    }
    await partition.cookies.flushStore();
    const remainingCookies = await cookiesForChat();
    if (remainingCookies.length === 0) {
      throw new Error("The imported session did not persist. Try the Chrome fallback again.");
    }
    seedStorage = { origin: CHAT_ORIGIN, items: snapshot.localStorage || {} };
    marker = null;
    removeMarker(markerFile);
    reloadChat?.();
    const verified = await verifyImportedInChat();
    if (!verified) {
      throw new Error(
        "The Chrome session was imported, but DeepSeek did not accept it inside DeepDeck. Try the Chrome fallback again; if it persists, use the site's email sign-in.",
      );
    }
    marker = { signedInAt: new Date().toISOString(), method: "chrome" };
    probeCache = { at: Date.now(), signedIn: true };
    writeMarker(markerFile, marker);
    await captureSnapshot("chrome", true);
  }

  /**
   * Re-check the chat view directly. Used after a navigation or page load so a
   * sign-in completed on the site itself is recognized, and a signed-out site
   * clears a stale marker.
   */
  async function verifyNow() {
    const contents = getChatContents?.();
    if (!contents || contents.isDestroyed()) return false;
    let loading = false;
    try { loading = contents.isLoading(); } catch { loading = false; }
    if (loading) return Boolean(marker);
    const signedIn = await detectSignedIn(contents, 3);
    if (signedIn) {
      if (!marker) {
        marker = { signedInAt: new Date().toISOString(), method: "web" };
        writeMarker(markerFile, marker);
      }
      probeCache = { at: Date.now(), signedIn: true };
      void captureSnapshot(marker.method || "web");
      emit();
      return true;
    }
    if (marker) {
      marker = null;
      removeMarker(markerFile);
      removeSnapshotFile(sessionFile);
      probeCache = { at: 0, signedIn: false };
      emit();
    }
    return false;
  }

  async function signOut() {
    stopChromeWatch();
    cancelMinimize();
    closeAuthWindow();
    if (chromeSession) {
      await chromeSession.shutdown();
      chromeSession = null;
    }
    await removeProfile(profileDir);
    try { await partition.clearStorageData(); } catch { /* best effort */ }
    try { await partition.clearCache(); } catch { /* best effort */ }
    marker = null;
    seedStorage = null;
    probeCache = { at: 0, signedIn: null };
    lastSnapshotAt = 0;
    removeMarker(markerFile);
    removeSnapshotFile(sessionFile);
    setPhase("idle", "Signed out of DeepSeek web.");
    reloadChat?.();
    return status();
  }

  async function cancelSignIn() {
    // An import is already reading the profile; let it settle rather than
    // tearing the Chrome window/profile out from under the reader.
    if (chromeFinishing) return status();
    stopChromeWatch();
    cancelMinimize();
    restoreApp();
    closeAuthWindow();
    if (chromeSession) {
      await chromeSession.shutdown();
      chromeSession = null;
    }
    // A failed import deliberately leaves the profile for a retry. Cancel is
    // the user saying no to that retry, so clean it up even when no live
    // Chrome session remains.
    await removeProfile(profileDir);
    setPhase("idle", "");
    return status();
  }

  /** Preload seed for Chrome-imported localStorage. Never includes cookies. */
  function seedFor(origin) {
    if (!seedStorage || seedStorage.origin !== origin) return null;
    return { origin, items: seedStorage.items };
  }

  function onState(callback) {
    emitter.callback = callback;
    emit();
    return () => { if (emitter.callback === callback) emitter.callback = null; };
  }

  return {
    partition,
    userAgent: ua,
    restore,
    status,
    signInInApp,
    beginChromeSignIn,
    focusChrome,
    switchToChrome,
    finishChromeSignIn,
    signOut,
    cancelSignIn,
    verifyNow,
    seedFor,
    onState,
    reloadMarker: () => { marker = readMarker(markerFile); },
    markSignedIn: method => {
      marker = { signedInAt: new Date().toISOString(), method: method || "web" };
      writeMarker(markerFile, marker);
      emit();
    },
    debug: () => redact(JSON.stringify({ phase, marker })),
  };
}

module.exports = {
  createWebSession,
  readMarker,
  writeMarker,
  removeMarker,
  HOME_URL,
  SIGN_IN_URL,
  CHAT_ORIGIN,
};
