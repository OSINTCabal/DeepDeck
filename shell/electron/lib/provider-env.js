/**
 * Provider environment sourced from the user's existing OpenCode credentials.
 *
 * OpenCode already owns the Mistral, Z.ai, MiniMax, and OpenCode Go keys. Rather
 * than copying those secrets into another store, DeepDeck reads the OpenCode
 * auth file when it starts the managed harness and passes only the environment
 * references the harness provider routes expect. Values are never logged or
 * sent to the shell renderer.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROVIDER_ENV = [
  ["mistral", "key", "MISTRAL_API_KEY"],
  ["zai", "key", "ZAI_API_KEY"],
  ["zai", "key", "Z_AI_API_KEY"],
  ["minimax", "key", "MINIMAX_API_KEY"],
  ["opencode-go", "key", "OPENCODE_API_KEY"],
];

function dataHome() {
  const configured = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim();
  return configured || path.join(os.homedir(), ".local", "share");
}

function readOpencodeAuth(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Build the provider-only environment for the harness child.
 * Existing process environment values win, so an explicit shell export can
 * override OpenCode without editing this app.
 * @param {{ dataHome?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Record<string, string>}
 */
function providerEnv({ dataHome: root, env = process.env } = {}) {
  const auth = readOpencodeAuth(path.join(root || dataHome(), "opencode", "auth.json"));
  const output = {};
  for (const [provider, field, name] of PROVIDER_ENV) {
    if (env[name] && env[name].trim()) continue;
    const value = auth[provider] && auth[provider][field];
    if (typeof value === "string" && value.trim()) output[name] = value.trim();
  }
  return output;
}

module.exports = { providerEnv, PROVIDER_ENV };
