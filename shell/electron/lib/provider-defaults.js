/**
 * Default provider routes for the managed harness.
 *
 * These routes are created only when the user has no route for that provider.
 * Existing profiles are never rewritten, so a custom base URL, model list, or
 * key reference wins. Keys come from the environment injected by
 * `provider-env.js` (sourced from the user's OpenCode auth file); no secret is
 * written into settings or logs.
 *
 * `opencode-go` is a first-class route in the installed pi-ai catalog. Its
 * models use mixed wire protocols and per-model base URLs (Anthropic messages,
 * OpenAI completions, OpenAI responses), so this route must not set a
 * route-level `api`, `baseURL`, or explicit model list. Older DeepDeck builds
 * wrote such an override; `ensureProviderDefaults` migrates that exact legacy
 * shape back to the catalog route.
 */

const fs = require("node:fs");
const path = require("node:path");

const OPENCODE_GO_ID = "opencode-go";
const OPENCODE_GO_ENV = "OPENCODE_API_KEY";
const OPENCODE_GO_LEGACY_BASE_URL = "https://opencode.ai/zen/go/v1";
// The exact model set DeepDeck wrote into its legacy forced route. A route
// with any other model list is user-customized and must not be rewritten.
const OPENCODE_GO_LEGACY_MODELS = new Set([
  "gpt-5.6-luna", "gpt-6-luna", "claude-haiku-5-5", "deepseek-v4-pro",
  "deepseek-v4.1-flash", "glm-5.3", "glm-5.3-flash", "kimi-k3",
  "kimi-k2.7-code", "minimax-m3", "qwen3.8-max", "qwen3.8-flash",
  "grok-4.7", "mimo-v2.6-pro", "step-5-preview", "longcat-2.0",
]);

const DEFAULTS = [
  { id: "zai", profile: { apiKeyEnv: "ZAI_API_KEY" } },
  { id: "mistral", profile: { apiKeyEnv: "MISTRAL_API_KEY" } },
  { id: "minimax", profile: { apiKeyEnv: "MINIMAX_API_KEY" } },
  {
    id: OPENCODE_GO_ID,
    profile: { displayName: "OpenCode Go", apiKeyEnv: OPENCODE_GO_ENV },
  },
];

function readSeeded(file) {
  if (!file) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeeded(file, ids) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify([...ids].sort(), null, 2)}\n`, { mode: 0o600 });
  } catch { /* seeding is advisory; provider setup still succeeded */ }
}

function namespaceView(describe, ns) {
  return (describe.namespaces || []).find(view => view.ns === ns);
}

function isLegacyOpencodeGo(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (profile.baseURL !== OPENCODE_GO_LEGACY_BASE_URL || profile.api !== "openai-completions") return false;
  if (!Array.isArray(profile.models) || profile.models.length !== OPENCODE_GO_LEGACY_MODELS.size) return false;
  // Only the app-written `{ id }` entries are safe to remove. Per-model
  // metadata means the user customized the list; leave it intact.
  if (!profile.models.every(model => model && typeof model === "object"
    && typeof model.id === "string"
    && Object.keys(model).every(key => key === "id"))) return false;
  const ids = profile.models.map(model => model.id);
  return new Set(ids).size === ids.length && ids.every(id => OPENCODE_GO_LEGACY_MODELS.has(id));
}

/**
 * Add missing provider routes to the harness settings.
 * @param {object} rpc authenticated harness RPC client
 * @param {{ logger?: object }} [options]
 * @returns {Promise<string[]>} provider ids that were added or migrated
 */
async function ensureProviderDefaults(rpc, { logger, seedFile } = {}) {
  const describe = await rpc.describeSettings();
  if (describe.writable !== true) return [];
  const view = namespaceView(describe, "llm-pi-ai");
  if (!view) return [];
  const providers = view.value && view.value.providers && typeof view.value.providers === "object"
    ? view.value.providers
    : {};
  const seeded = readSeeded(seedFile);
  const ops = [];
  const changed = [];
  for (const entry of DEFAULTS) {
    const current = providers[entry.id];
    // Migration is independent of the seed: a legacy route can reappear via a
    // settings restore or downgrade after the seed marker was written.
    if (entry.id === OPENCODE_GO_ID && isLegacyOpencodeGo(current)) {
      // Remove only the three route-level overrides that forced every catalog
      // model onto one protocol. Preserve custom headers, timeouts, and other
      // fields the user may have added to the legacy profile.
      const base = ["providers", entry.id];
      ops.push(
        { op: "unset", path: [...base, "api"] },
        { op: "unset", path: [...base, "baseURL"] },
        { op: "unset", path: [...base, "models"] },
      );
      if (typeof current.apiKeyEnv !== "string" || !current.apiKeyEnv.trim()) {
        ops.push({ op: "set", path: [...base, "apiKeyEnv"], value: OPENCODE_GO_ENV });
      }
      if (typeof current.displayName !== "string" || !current.displayName.trim()) {
        ops.push({ op: "set", path: [...base, "displayName"], value: "OpenCode Go" });
      }
      changed.push(entry.id);
      continue;
    }
    // Once a default has been offered, a deliberate deletion must stick.
    if (seeded.has(entry.id)) continue;
    if (!Object.prototype.hasOwnProperty.call(providers, entry.id)) {
      ops.push({ op: "set", path: ["providers", entry.id], value: entry.profile });
      changed.push(entry.id);
    }
  }
  if (ops.length > 0) {
    await rpc.mutateSettings("llm-pi-ai", ops, view.revision);
    logger?.info(`provider defaults updated: ${changed.join(", ")}`);
  }
  const nextSeeded = new Set(seeded);
  for (const entry of DEFAULTS) nextSeeded.add(entry.id);
  writeSeeded(seedFile, nextSeeded);
  return changed;
}

module.exports = {
  ensureProviderDefaults,
  OPENCODE_GO_ID,
  OPENCODE_GO_ENV,
  OPENCODE_GO_LEGACY_BASE_URL,
  OPENCODE_GO_LEGACY_MODELS,
  DEFAULTS,
};
