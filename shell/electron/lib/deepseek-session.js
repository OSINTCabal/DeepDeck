/**
 * DeepSeek web session detection.
 *
 * The site writes a bearer token into `localStorage.userToken` (a
 * `{ value, __version }` wrapper) and/or `settingsJwt`, and validates it
 * against `/api/v0/users/current`. An anonymous visit still has a
 * `ds_session_id` cookie, so neither the cookie name nor "not on the password
 * page" is a signed-in signal. This expression is the single source of truth
 * used by the in-app flow, the Chrome importer, and the periodic status probe.
 *
 * Candidate tokens are tried in order. Only an API response with code 0 and a
 * user payload counts as signed in. The expression never returns or prints a
 * token value; failures are reported as not signed in.
 */

const SIGNED_IN_EXPRESSION = `(async () => {
  const result = (signedIn, reason, extra) => Object.assign({ signedIn, reason, href: location.href }, extra || {});
  try {
    const tokens = new Set();
    const add = value => {
      if (typeof value === "string" && value.length > 16 && !value.includes(" ")) tokens.add(value);
    };
    const flatten = (value, depth = 0) => {
      if (depth > 3 || value == null) return;
      if (typeof value === "string") { add(value); return; }
      if (typeof value !== "object") return;
      for (const key of Object.keys(value)) {
        if (/token|jwt|auth|access|^value$/i.test(key)) flatten(value[key], depth + 1);
      }
    };
    const readStorage = key => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        try { flatten(JSON.parse(raw)); } catch { add(raw); }
      } catch { /* storage unavailable */ }
    };
    readStorage("userToken");
    readStorage("settingsJwt");
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && /token|jwt|auth|access/i.test(key) && !/waf/i.test(key)) readStorage(key);
      }
    } catch { /* storage unavailable */ }

    const candidates = [...tokens].slice(0, 8);
    let unauthorized = false;
    for (const token of candidates) {
      try {
        const response = await fetch("/api/v0/users/current", {
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json", authorization: "Bearer " + token },
        });
        let data = null;
        try { data = await response.json(); } catch { data = null; }
        const code = data && data.code;
        if (data && (code === 0 || code === "0") && data.data) {
          return result(true, "ok", { code, candidates: candidates.length });
        }
        if (response.status === 401 || response.status === 403) {
          // A stale or unrelated token must not hide a valid one later in the
          // list (for example settingsJwt before the real userToken).
          unauthorized = true;
        }
      } catch { /* try the next candidate */ }
    }

    // Some deployments authenticate the user endpoint by cookie alone.
    try {
      const response = await fetch("/api/v0/users/current", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      const code = data && data.code;
      if (data && (code === 0 || code === "0") && data.data) return result(true, "cookie", { code });
      return result(false, unauthorized ? "unauthorized" : candidates.length ? "token-rejected" : "no-token", { code: code === undefined ? null : code, candidates: candidates.length });
    } catch {
      return result(false, "request-failed", { candidates: candidates.length });
    }
  } catch (error) {
    return result(false, "request-failed", { detail: String(error) });
  }
})()`;

module.exports = { SIGNED_IN_EXPRESSION };
