/**
 * Authenticated client for the dsh Web Host's unary RPC surface.
 *
 * `dsh web` prints `http://127.0.0.1:<port>/?token=<launch-token>`. A GET on
 * that URL answers 303 with a signed, authority-bound HttpOnly cookie. DeepDeck
 * exchanges the token once in the main process and posts unary envelopes:
 *
 *   { type: "client-request", rpcId, method, payload: { args } }
 *   { type: "server-response", rpcId, result: { ok: true, value } }
 *
 * The token, cookie, and response bodies stay in main-process memory. Nothing
 * here writes to disk.
 */

const { randomUUID } = require("node:crypto");

class HarnessRpcError extends Error {
  constructor(message, { status = 0, code = "HARNESS_RPC_FAILED", details = null } = {}) {
    super(message);
    this.name = "HarnessRpcError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function firstSetCookie(headers) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : null;
  if (Array.isArray(list) && list.length > 0) return list[0];
  const raw = headers.get("set-cookie");
  return raw ? raw.split(/,(?=[^;,]+=)/)[0] : "";
}

/**
 * Exchange a launch URL for the browser-session cookie.
 * @param {string} tokenUrl
 * @param {{ timeoutMs?: number }} options
 */
async function exchangeSession(tokenUrl, { timeoutMs = 15000 } = {}) {
  const parsed = new URL(tokenUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new HarnessRpcError("Harness launch URL is not loopback HTTP");
  }
  const response = await fetch(tokenUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "DeepDeck" },
  });
  const setCookie = firstSetCookie(response.headers);
  const cookie = setCookie.split(";")[0];
  if (!cookie || !cookie.includes("=")) {
    throw new HarnessRpcError(
      `Harness token exchange returned HTTP ${response.status} without a session cookie`,
      { status: response.status },
    );
  }
  return {
    origin: parsed.origin,
    port: Number(parsed.port || 80),
    cookie,
    exchangedAt: Date.now(),
  };
}

/**
 * Create a client over an already-exchanged session.
 * @param {{ origin: string, cookie: string }} session
 */
function createRpcClient(session, { timeoutMs = 20000 } = {}) {
  if (!session || !session.origin || !session.cookie) {
    throw new HarnessRpcError("Missing harness RPC session");
  }
  const origin = session.origin;

  async function call(method, args = {}, options = {}) {
    const rpcId = randomUUID();
    const timeout = options.timeoutMs ?? timeoutMs;
    let response;
    try {
      response = await fetch(`${origin}/api/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
          origin,
        },
        body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new HarnessRpcError(`Harness request failed: ${error.message}`, { code: "HARNESS_UNREACHABLE" });
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new HarnessRpcError(`Harness returned non-JSON (HTTP ${response.status})`, { status: response.status });
    }
    if (!response.ok) {
      throw new HarnessRpcError(`Harness returned HTTP ${response.status} for ${method}`, { status: response.status });
    }
    if (!body || body.type !== "server-response" || body.rpcId !== rpcId) {
      throw new HarnessRpcError(`Harness returned an invalid response envelope for ${method}`);
    }
    const result = body.result;
    if (!result || result.ok !== true) {
      const error = result && result.error ? result.error : {};
      throw new HarnessRpcError(error.message || `Harness rejected ${method}`, {
        code: error.code || "HARNESS_REJECTED",
        details: error.details || null,
      });
    }
    return result.value;
  }

  return {
    origin,
    call,
    listBundles: () => call("pluginManager/listBundles"),
    listPlugins: () => call("pluginManager/listPlugins"),
    installBundle: spec => call("pluginManager/installBundle", { spec, options: { saveExact: true } }, { timeoutMs: 15 * 60_000 }),
    setBundleEnabled: (name, enabled) => call("pluginManager/setBundleEnabled", { name, enabled }),
    removeBundle: name => call("pluginManager/removeBundle", { name }, { timeoutMs: 15 * 60_000 }),
    listPresets: () => call("agentPresets/list"),
    readPreset: agentPreset => call("agentPresets/read", { agentPreset }),
    describeSettings: () => call("settings/describe"),
    mutateSettings: (ns, ops, expectedRevision) => call("settings/mutate", { ns, ops, expectedRevision }),
    updateSettings: (ns, patch, expectedRevision) => call("settings/update", { ns, patch, expectedRevision }),
    describeCredentials: refs => call("credentials/describe", { refs }),
    setCredential: (ref, value) => call("credentials/set", { ref, value }),
    unsetCredential: ref => call("credentials/unset", { ref }),
    listProviders: () => call("llm/listProviders"),
    listConfigurableProviders: () => call("llm/listConfigurableProviders"),
    discoverModels: (settingsNs, request, options = {}) =>
      call("llm/discoverModels", { settingsNs, request }, options),
  };
}

module.exports = {
  HarnessRpcError,
  exchangeSession,
  createRpcClient,
  firstSetCookie,
};
