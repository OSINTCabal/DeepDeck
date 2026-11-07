/**
 * Chrome-assisted DeepSeek web sign-in.
 *
 * Google OAuth is unreliable inside Electron user agents. This module lets the
 * user complete the real Google flow in a normal Chrome/Chromium window with a
 * private profile, then reads that profile's DeepSeek cookies and chat-origin
 * localStorage over the DevTools protocol. The profile is temporary: after a
 * successful import it is deleted, so the only surviving session is DeepDeck's
 * own persistent Electron partition.
 *
 * WAF state is deliberately excluded. `aws-waf-token` (and the `aws_waf*`
 * storage keys) bind to one browser's challenge and must never be replayed.
 */

const { spawn } = require("node:child_process");
const { SIGNED_IN_EXPRESSION } = require("./deepseek-session");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/brave-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const WAF_NAME = /^(?:aws[-_]?waf|awswaf)/i;
const SIGN_IN_URL = "https://chat.deepseek.com/sign_in";
const HOME_URL = "https://chat.deepseek.com/";

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch { /* try the next installed browser */ }
  }
  return null;
}

function isDeepSeekDomain(domain) {
  const clean = String(domain || "").replace(/^\./, "").toLowerCase();
  return clean === "deepseek.com" || clean.endsWith(".deepseek.com");
}

function isWafName(name) {
  return WAF_NAME.test(String(name || ""));
}

/** Keep only cookies that carry the DeepSeek web session; never WAF or Google. */
function filterCookies(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter(cookie => cookie && typeof cookie.name === "string" && isDeepSeekDomain(cookie.domain))
    .filter(cookie => !isWafName(cookie.name) && !cookie.partitionKey)
    .map(cookie => ({
      domain: cookie.domain,
      name: cookie.name,
      value: String(cookie.value ?? ""),
      path: cookie.path || "/",
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: cookie.sameSite || "",
      expires: typeof cookie.expires === "number" ? cookie.expires : -1,
    }));
}

/** Keep non-WAF localStorage values; size-bound so a hostile page cannot bloat memory. */
function filterLocalStorage(entries) {
  const result = {};
  let bytes = 0;
  for (const [key, value] of Object.entries(entries || {})) {
    if (typeof key !== "string" || isWafName(key)) continue;
    if (typeof value !== "string") continue;
    bytes += key.length + value.length;
    if (bytes > 4 * 1024 * 1024) break;
    result[key] = value;
  }
  return result;
}

function sameSiteForElectron(value) {
  switch (String(value || "").toLowerCase()) {
    case "strict": return "strict";
    case "lax": return "lax";
    case "none":
    case "no_restriction": return "no_restriction";
    default: return "unspecified";
  }
}

/** Convert one CDP cookie into Electron's cookie payload. */
function electronCookie(cookie) {
  const domain = String(cookie.domain || "").replace(/^\./, "");
  if (!domain) return null;
  const url = `https://${domain}${cookie.path || "/"}`;
  const detail = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: sameSiteForElectron(cookie.sameSite),
  };
  if (String(cookie.domain).startsWith(".")) detail.domain = cookie.domain;
  // A CDP session cookie (expires -1) is dropped by Chromium on shutdown; the
  // imported session must survive restarts, so give it a 30-day horizon.
  detail.expirationDate = typeof cookie.expires === "number" && cookie.expires > 0
    ? cookie.expires
    : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  return detail;
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readDevToolsPort(profileDir, timeoutMs = 20000) {
  const file = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port, browserPath] = (await fs.readFile(file, "utf8")).trim().split("\n");
      if (/^\d+$/.test(port) && browserPath && browserPath.startsWith("/devtools/browser/")) {
        return { base: `http://127.0.0.1:${port}`, browserPath };
      }
    } catch { /* Chrome has not written it yet */ }
    await pause(150);
  }
  throw new Error("Chrome's debugging endpoint did not appear.");
}

async function cdpCommand(base, target, method, params = {}, timeoutMs = 15000) {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/devtools/${target}`);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Chrome request timed out: ${method}`));
        try { socket.close(); } catch { /* already closed */ }
      }, timeoutMs);
      const fail = () => {
        clearTimeout(timer);
        reject(new Error(`Chrome connection closed during ${method}`));
      };
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, method, params }));
      }, { once: true });
      socket.addEventListener("message", event => {
        let data;
        try { data = JSON.parse(event.data); } catch { fail(); return; }
        if (data.id !== 1) return;
        clearTimeout(timer);
        if (data.error) reject(new Error(data.error.message || `${method} failed`));
        else resolve(data.result);
      });
    });
  } finally {
    try { socket.close(); } catch { /* already closed */ }
  }
}

async function listPages(base) {
  const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
  return (await response.json()).filter(page => page.type === "page");
}

/**
 * Open an interactive Chrome window. The caller confirms completion, then
 * `readSnapshot()` harvests the signed-in state and stops the browser.
 */
function createChromeSession({ profileDir, logger }) {
  let child = null;
  let quitting = false;

  async function debugEndpoint() {
    try {
      const { base, browserPath } = await readDevToolsPort(profileDir, 1200);
      const info = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (!info.ok) return null;
      return { base, browserPath };
    } catch {
      return null;
    }
  }

  async function clearStaleProfileFiles() {
    for (const name of ["DevToolsActivePort", "SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      try { await fs.rm(path.join(profileDir, name), { force: true }); } catch { /* best effort */ }
    }
  }

  async function start() {
    const chrome = findChrome();
    if (!chrome) throw new Error("Install Google Chrome or Chromium to use the Chrome sign-in fallback.");
    await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
    try { await fs.chmod(profileDir, 0o700); } catch { /* best effort */ }
    // If a Chrome from a previous failed attempt still owns this profile, use
    // its live DevTools endpoint rather than spawning a second browser.
    const existing = await debugEndpoint();
    if (existing) {
      logger?.info("reusing the existing Chrome sign-in window");
      return { chrome };
    }
    await clearStaleProfileFiles();
    child = spawn(chrome, [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      // Chrome exposes navigator.webdriver=true as soon as remote debugging is
      // on in current builds. Google treats that as an automation browser and
      // refuses the account flow. This blink flag restores the normal web
      // platform signal while keeping the DevTools endpoint available for the
      // post-sign-in session read. It controls no browsing behavior.
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--new-window",
      SIGN_IN_URL,
    ], { stdio: "ignore", detached: true });
    child.unref();
    // The endpoint is required for the live read. It normally appears in a
    // second; a warning leaves the headless fallback available if it does not.
    try { await readDevToolsPort(profileDir, 15000); }
    catch { logger?.warn("Chrome did not expose a DevTools endpoint; the headless reader will be used"); }
    logger?.info("opened Chrome for DeepSeek web sign-in");
    return { chrome };
  }

  async function closeBrowser() {
    // Close a browser even when this process did not spawn it (a reused
    // profile from a previous attempt), then make sure the child is gone.
    try {
      const { base, browserPath } = await readDevToolsPort(profileDir, 1500);
      await cdpCommand(base, browserPath.slice("/devtools/".length), "Browser.close", {}, 3000).catch(() => {});
    } catch { /* no endpoint */ }
    for (let i = 0; i < 80 && child && child.exitCode === null && child.signalCode === null; i += 1) await pause(100);
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGTERM"); } catch { /* gone */ }
    }
    child = null;
  }

  function isChatPage(page) {
    try { return new URL(page.url).hostname === "chat.deepseek.com"; } catch { return false; }
  }

  async function chatPages(base, waitMs = 0) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const pages = await listPages(base).catch(() => []);
      const chat = pages.filter(isChatPage);
      if (chat.length > 0 || Date.now() >= deadline) return chat;
      await pause(300);
    }
  }

  /**
   * Google can leave the callback tab open while the original DeepSeek tab
   * receives the token, and retries can leave more than one DeepSeek tab
   * behind. Check every DeepSeek page so a stale sign-in tab cannot mask the
   * signed-in one. Returns the first page that verifies.
   */
  async function signedInPage(base, { attempts = 1, pauseMs = 450, waitMs = 0 } = {}) {
    let lastState = {};
    let pages = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      pages = await chatPages(base, attempt === 0 ? waitMs : 0);
      for (const page of pages.slice(0, 4)) {
        const result = await cdpCommand(base, `page/${page.id}`, "Runtime.evaluate", {
          expression: SIGNED_IN_EXPRESSION,
          awaitPromise: true,
          returnByValue: true,
        }, 15000).catch(() => null);
        const state = result && result.result ? result.result.value || {} : {};
        lastState = state;
        if (state.signedIn === true) return { page, state, pages };
      }
      if (attempt + 1 < attempts) await pause(pauseMs);
    }
    return { page: null, state: lastState, pages };
  }

  async function liveSnapshot() {
    if (quitting) throw new Error("Sign-in was cancelled.");
    const { base, browserPath } = await readDevToolsPort(profileDir, 5000);
    const browserTarget = browserPath.slice("/devtools/".length);
    // The watcher has already seen a signed-in tab before calling this. A few
    // retries cover a token write racing the probe; looping for tens of seconds
    // only leaves the UI stuck on "Importing" when the tab is still signed out.
    const signed = await signedInPage(base, { attempts: 3, pauseMs: 450, waitMs: 3000 });
    const page = signed.page;
    const state = signed.state;
    if (!page) {
      const reason = state.reason || "not-signed-in";
      logger?.warn(`Chrome session check: ${JSON.stringify({ reason, code: state.code ?? null, href: state.href || null, pages: signed.pages.length })}`);
      const message = signed.pages.length === 0
        ? "DeepSeek is not open in Chrome yet. Finish signing in until the DeepSeek chat tab appears, then choose I have signed in again."
        : reason === "no-token"
          ? "Chrome is still signed out of DeepSeek: no user token was found on the DeepSeek tab. Finish signing in until the chat appears, then choose I have signed in again."
          : reason === "request-failed"
            ? "DeepSeek did not answer the session check from Chrome. Make sure the Chrome DeepSeek tab is fully loaded, then try again."
            : "Chrome has not established a DeepSeek session yet. Finish signing in until the chat appears, then choose I have signed in again.";
      const error = new Error(message);
      error.code = "CHROME_NOT_SIGNED_IN";
      error.detail = state;
      throw error;
    }

    let cookies = [];
    try {
      const all = await cdpCommand(base, browserTarget, "Storage.getCookies", {}, 8000);
      cookies = filterCookies(all.cookies || []);
    } catch { cookies = []; }
    if (cookies.length === 0) {
      const cookieResult = await cdpCommand(base, `page/${page.id}`, "Network.getCookies", {
        urls: [HOME_URL, SIGN_IN_URL, "https://deepseek.com/", "https://login.deepseek.com/"],
      }).catch(() => ({ cookies: [] }));
      cookies = filterCookies(cookieResult.cookies || []);
    }
    const storage = await cdpCommand(base, `page/${page.id}`, "Runtime.evaluate", {
      expression: `(() => {
        try {
          const out = {};
          for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key) out[key] = localStorage.getItem(key);
          }
          return JSON.stringify(out);
        } catch { return "{}"; }
      })()`,
      returnByValue: true,
    }, 8000).catch(() => null);
    let entries = {};
    try { entries = JSON.parse(storage && storage.result ? storage.result.value || "{}" : "{}"); } catch { entries = {}; }
    const localStorage = filterLocalStorage(entries);
    await closeBrowser();
    if (quitting) throw new Error("Sign-in was cancelled.");
    return { cookies, localStorage, capturedAt: new Date().toISOString() };
  }

  async function headlessSnapshot() {
    const chrome = findChrome();
    await clearStaleProfileFiles();
    const reader = spawn(chrome, [
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      HOME_URL,
    ], { stdio: "ignore", detached: true });
    reader.unref();
    try {
      const { base, browserPath } = await readDevToolsPort(profileDir);
      const browserTarget = browserPath.slice("/devtools/".length);
      let pages = await listPages(base);
      if (pages.length === 0) {
        const created = await cdpCommand(base, browserTarget, "Target.createTarget", { url: HOME_URL });
        for (let i = 0; i < 50; i += 1) {
          pages = await listPages(base);
          if (pages.some(page => page.id === created.targetId)) break;
          await pause(100);
        }
      }
      let page = pages.find(isChatPage) || pages[0];
      if (!page) throw new Error("Chrome did not open a DeepSeek page.");

      for (let i = 0; i < 80; i += 1) {
        const current = (await listPages(base)).find(candidate => candidate.id === page.id);
        if (current) page = current;
        let href = "";
        try { href = page.url || ""; } catch { href = ""; }
        if (!href.startsWith("https://chat.deepseek.com")) {
          await cdpCommand(base, `page/${page.id}`, "Page.navigate", { url: HOME_URL }, 5000).catch(() => {});
        } else {
          const ready = await cdpCommand(base, `page/${page.id}`, "Runtime.evaluate", {
            expression: "document.readyState",
            returnByValue: true,
          }, 3000).catch(() => null);
          if (ready && ready.result && ready.result.value && ready.result.value !== "loading") break;
        }
        await pause(150);
      }
      await pause(900);

      const signed = await signedInPage(base, { attempts: 8, pauseMs: 400 });
      if (!signed.page) {
        const error = new Error("Chrome is closed and its saved profile does not contain a verified DeepSeek session. Start the Chrome sign-in again.");
        error.code = "CHROME_NOT_SIGNED_IN";
        error.detail = signed.state;
        throw error;
      }
      page = signed.page;

      let cookies = [];
      try {
        const all = await cdpCommand(base, browserTarget, "Storage.getCookies", {}, 8000);
        cookies = filterCookies(all.cookies || []);
      } catch { cookies = []; }
      if (cookies.length === 0) {
        const cookieResult = await cdpCommand(base, `page/${page.id}`, "Network.getCookies", {
          urls: [HOME_URL, SIGN_IN_URL, "https://deepseek.com/", "https://login.deepseek.com/"],
        });
        cookies = filterCookies(cookieResult.cookies || []);
      }
      const storage = await cdpCommand(base, `page/${page.id}`, "Runtime.evaluate", {
        expression: `(() => {
          const out = {};
          for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key) out[key] = localStorage.getItem(key);
          }
          return JSON.stringify(out);
        })()`,
        returnByValue: true,
      });
      let entries = {};
      try { entries = JSON.parse(storage.result?.value || "{}"); } catch { entries = {}; }
      return { cookies, localStorage: filterLocalStorage(entries), capturedAt: new Date().toISOString() };
    } finally {
      try { reader.kill("SIGTERM"); } catch { /* gone */ }
      try {
        const { base, browserPath } = await readDevToolsPort(profileDir, 800);
        await cdpCommand(base, browserPath.slice("/devtools/".length), "Browser.close", {}, 2000).catch(() => {});
      } catch { /* already closed */ }
      // Do not leave a singleton lock behind for a retry with this profile.
      await clearStaleProfileFiles();
    }
  }

  /** Cheap live check used by the automatic completion watcher. */
  async function probe() {
    if (quitting) return false;
    const endpoint = await debugEndpoint();
    if (!endpoint) return false;
    const signed = await signedInPage(endpoint.base);
    return Boolean(signed.page);
  }

  /** Raise the Chrome window and its DeepSeek tab, if both still exist. */
  async function focus() {
    if (quitting) return false;
    const endpoint = await debugEndpoint();
    if (!endpoint) return false;
    const pages = await chatPages(endpoint.base, 0);
    const page = pages.find(candidate => !/\/sign_in(?:[/?#]|$)/.test(candidate.url)) || pages[0];
    if (!page) return false;
    try {
      await cdpCommand(endpoint.base, `page/${page.id}`, "Page.bringToFront", {}, 3000);
      return true;
    } catch {
      return false;
    }
  }

  async function readSnapshot() {
    if (quitting) throw new Error("Sign-in was cancelled.");
    if (child && child.exitCode === null && child.signalCode === null) return liveSnapshot();
    // A previous attempt may have left Chrome running; use its live endpoint.
    if (await debugEndpoint()) return liveSnapshot();
    return headlessSnapshot();
  }

  async function shutdown() {
    quitting = true;
    await closeBrowser();
  }

  return {
    start,
    probe,
    focus,
    alive: async () => Boolean(await debugEndpoint()) || Boolean(child && child.exitCode === null && child.signalCode === null),
    readSnapshot,
    shutdown,
    isOpen: () => Boolean(child && child.exitCode === null && child.signalCode === null),
  };
}

/** Remove the temporary Chrome profile; safe when it does not exist. */
async function removeProfile(profileDir) {
  try { await fs.rm(profileDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

module.exports = {
  findChrome,
  filterCookies,
  filterLocalStorage,
  electronCookie,
  sameSiteForElectron,
  isDeepSeekDomain,
  isWafName,
  createChromeSession,
  removeProfile,
};
