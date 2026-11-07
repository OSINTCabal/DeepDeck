/**
 * Security helpers shared by the Electron main process and its tests.
 *
 * DeepDeck embeds two unrelated remote applications and exposes a privileged
 * IPC bridge only to its own shell document. The helpers here keep every trust
 * decision explicit: which documents may call IPC, which links may stay inside
 * a view, which links may open externally, and how log text is scrubbed.
 */

const CHAT_HOSTS = new Set([
  "deepseek.com",
  "www.deepseek.com",
  "chat.deepseek.com",
  "login.deepseek.com",
  "platform.deepseek.com",
  "cdn.deepseek.com",
  "accounts.google.com",
  "accounts.youtube.com",
  "myaccount.google.com",
  "appleid.apple.com",
]);

/** True for any host that may navigate inside the DeepSeek chat view. */
function isChatNavigationHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  if (CHAT_HOSTS.has(host)) return true;
  return host.endsWith(".deepseek.com") || host.endsWith(".google.com");
}

/** True for hosts that may navigate inside the API-usage dashboard. */
function isDeepSeekHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "deepseek.com" || host.endsWith(".deepseek.com");
}

/** True for Google-owned hosts whose user agent must not mention Electron. */
function isGoogleAuthHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "accounts.google.com"
    || host === "accounts.youtube.com"
    || host === "myaccount.google.com"
    || host.endsWith(".gstatic.com");
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** External links open in the system browser only for plain https URLs. */
function externalUrl(value) {
  const url = parseHttpUrl(value);
  return url && url.protocol === "https:" ? url.href : null;
}

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/**
 * True for loopback, private, link-local, CGNAT, and mDNS hostnames. The
 * embedded DeepSeek page is remote; it must never reach the harness, the
 * DeepDeck shell server, or another service on the user's machine. This is a
 * hostname check (the URL layer), so it is a defense-in-depth layer rather than
 * a DNS-rebinding-proof sandbox.
 */
function isPrivateNetworkHost(hostname) {
  let host = String(hostname || "").trim().toLowerCase();
  if (!host) return false;
  host = host.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".localdomain") || host.endsWith(".home.arpa")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some(octet => octet > 255)) return false;
    const [a, b, c] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113);
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) follows the IPv4 rules, in both the
  // dotted and the hexadecimal forms.
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateNetworkHost(mapped[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateNetworkHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  if (host.includes(":")) {
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true; // unique-local fc00::/7
    if (/^ff[0-9a-f]{2}:/i.test(host)) return true; // multicast
    return false;
  }
  return false;
}

function sameOrigin(value, origin) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Build the check that guards every ipcMain handler. Both the sending
 * webContents and the sending frame origin must belong to the shell document.
 */
function createTrustedSender(getWindow, getOrigin) {
  return event => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    if (event.sender !== win.webContents) return false;
    const senderFrame = event.senderFrame;
    if (!senderFrame || senderFrame.parent !== null) return false;
    return sameOrigin(senderFrame.url, getOrigin());
  };
}

const TOKEN_PATTERN = /\btoken=[A-Za-z0-9_-]+/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g;
const SECRET_KEY_PATTERN = /\b(?:sk|pk|api[_-]?key|secret|token)[-_"':=\s]{1,4}[A-Za-z0-9_.-]{12,}/gi;
// The managed harness receives these names from the OpenCode auth bridge. A
// child process that dumps its environment must not write their values to a
// log or into the error tail broadcast to the renderer.
const ENV_SECRET_PATTERN = /\b(?:MISTRAL|MINIMAX|OPENCODE|ZAI|Z_AI|OPENROUTER|DEEPSEEK)_API_KEY\s*[:=]\s*[^\s"'`]+/gi;
const LABELED_SECRET_PATTERN = /\b(?:api[\s_-]?key|secret|password|passwd)\b\s*[:=]\s*["']?[^\s"',;]{8,}/gi;

/**
 * Scrub bearer secrets from anything written to a log or shown in an error.
 * @param {string} text
 * @param {Iterable<string>} [knownSecrets] exact values to remove (env-injected keys)
 */
function redact(text, knownSecrets = []) {
  let output = String(text ?? "");
  for (const secret of knownSecrets) {
    if (typeof secret !== "string" || secret.length < 8) continue;
    output = output.split(secret).join("<redacted>");
  }
  return output
    .replace(TOKEN_PATTERN, "token=<redacted>")
    .replace(BEARER_PATTERN, "Bearer <redacted>")
    .replace(ENV_SECRET_PATTERN, match => match.replace(/[:=]\s*[^\s"'`]+$/, "=<redacted>"))
    .replace(LABELED_SECRET_PATTERN, match => match.replace(/[:=]\s*["']?[^\s"',;]+$/, "=<redacted>"))
    .replace(SECRET_KEY_PATTERN, match => {
      const prefix = match.slice(0, Math.max(0, match.search(/[A-Za-z0-9_.-]{12,}$/)));
      return `${prefix}<redacted>`;
    });
}

/** Normalize a Chrome/Chromium user agent by removing only the Electron token. */
function chromeUserAgent(chromeVersion, platform = process.platform) {
  const version = String(chromeVersion || "0.0.0.0");
  const osToken = platform === "darwin"
    ? "Macintosh; Intel Mac OS X 10_15_7"
    : platform === "win32"
      ? "Windows NT 10.0; Win64; x64"
      : "X11; Linux x86_64";
  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function stripElectronToken(userAgent) {
  return String(userAgent || "")
    .replace(/\sElectron\/[^\s]+/gi, "")
    .replace(/\sDeepDeck\/[^\s]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

module.exports = {
  isChatNavigationHost,
  isGoogleAuthHost,
  parseHttpUrl,
  externalUrl,
  isDeepSeekHost,
  isLoopbackHost,
  isPrivateNetworkHost,
  sameOrigin,
  createTrustedSender,
  redact,
  chromeUserAgent,
  stripElectronToken,
  CHAT_HOSTS,
};
