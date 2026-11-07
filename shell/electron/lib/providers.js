/**
 * Provider control plane over the harness's own settings/credentials/llm RPC.
 *
 * DeepDeck never edits `settings.yaml` or `.credentials.yaml` directly. The
 * harness is the authority: it validates provider profiles, applies them live,
 * tracks revisions for conflict detection, and reports credential state without
 * revealing key values.
 */

const { HarnessRpcError } = require("./harness-rpc");

const API_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];

const PRESETS = {
  "deepseek-official": {
    label: "DeepSeek",
    ref: "DEEPSEEK_API_KEY",
    order: 0,
    builtin: true,
    note: "Official DeepSeek API. The harness route is deepseek-official.",
  },
  openai: { label: "OpenAI", ref: "OPENAI_API_KEY", order: 10, note: "OpenAI platform API key." },
  anthropic: { label: "Claude", ref: "ANTHROPIC_API_KEY", order: 11, note: "Anthropic API key." },
  google: {
    label: "Google AI Studio",
    ref: "GEMINI_API_KEY",
    order: 12,
    note: "Gemini API key from AI Studio; Google web sign-in alone is not an API credential.",
  },
  zai: { label: "Z.ai", ref: "ZAI_API_KEY", order: 13, note: "Z.ai API key, including Coding Plan access subject to its tool policy." },
  openrouter: { label: "OpenRouter", ref: "OPENROUTER_API_KEY", order: 14, note: "OpenRouter key; exposes its full model catalog." },
  minimax: { label: "MiniMax", ref: "MINIMAX_API_KEY", order: 15, note: "MiniMax API or Token Plan key." },
  mistral: { label: "Mistral", ref: "MISTRAL_API_KEY", order: 16, note: "Mistral API key." },
  moonshotai: { label: "Moonshot / Kimi", ref: "MOONSHOT_API_KEY", order: 17, note: "Moonshot API key." },
  xai: { label: "xAI", ref: "XAI_API_KEY", order: 18, note: "xAI API key." },
  "openai-codex": {
    label: "Codex / ChatGPT",
    ref: null,
    order: 19,
    oauthOnly: true,
    note: "OAuth-only in the installed harness catalog; ambient Codex authentication is authoritative.",
  },
  ollama: {
    label: "Ollama (local)",
    ref: "OLLAMA_API_KEY",
    order: 20,
    custom: true,
    note: "Local OpenAI-compatible endpoint. Add the models you have pulled.",
  },
};

function presetFor(provider) {
  return PRESETS[provider] || null;
}

function deriveRef(provider) {
  return `${String(provider || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_API_KEY`;
}

function refFor(provider, preset) {
  return (preset && preset.ref) || deriveRef(provider);
}

function readPath(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function namespaceView(describe, ns) {
  return (describe.namespaces || []).find(view => view.ns === ns);
}

function profileFor(describe, settingsNs, settingsPath) {
  const view = namespaceView(describe, settingsNs);
  if (!view) return undefined;
  if (!settingsPath || settingsPath.length === 0) return view.value;
  return readPath(view.value, settingsPath);
}

function refsFor(describe, directory) {
  const refs = new Set();
  for (const entry of directory) {
    const profile = profileFor(describe, entry.settingsNs, entry.settingsPath);
    const ref = profile && typeof profile === "object" ? profile.apiKeyEnv : undefined;
    if (typeof ref === "string" && ref.trim()) refs.add(ref);
    else if (entry.settingsPath.length > 0) refs.add(refFor(entry.provider, presetFor(entry.provider)));
  }
  return [...refs];
}

function deepSeekModels(describe) {
  const view = namespaceView(describe, "llm-deepseek");
  const models = view && view.value && Array.isArray(view.value.models) ? view.value.models : [];
  return models.map(model => ({ id: model.id, name: model.name || model.id }));
}

/** Build the provider view model from one describe + directory snapshot. */
async function loadProviders(rpc, { discoverActive = true } = {}) {
  const [describe, directory, active] = await Promise.all([
    rpc.describeSettings(),
    rpc.listConfigurableProviders(),
    rpc.listProviders(),
  ]);
  const activeIds = new Set((active || []).map(entry => entry.id));
  const refs = refsFor(describe, directory);
  const credentials = await rpc.describeCredentials(refs);

  const entries = directory.map(entry => ({ ...entry, synthetic: false }));
  if (!entries.some(entry => entry.provider === "ollama")) {
    entries.push({
      provider: "ollama",
      displayName: "Ollama",
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", "ollama"],
      synthetic: true,
    });
  }

  const providers = [];
  for (const entry of entries) {
    const preset = presetFor(entry.provider);
    const profile = profileFor(describe, entry.settingsNs, entry.settingsPath);
    const configured = profile !== undefined && profile !== null && typeof profile === "object";
    const ref = configured && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.trim()
      ? profile.apiKeyEnv
      : refFor(entry.provider, preset);
    const credential = preset && preset.oauthOnly ? null : credentials[ref] || null;
    const isActive = activeIds.has(entry.provider);
    let models = null;
    if (entry.provider === "deepseek-official") {
      models = deepSeekModels(describe);
    } else if (discoverActive && (isActive || configured) && preset?.oauthOnly !== true) {
      try {
        models = await rpc.discoverModels(entry.settingsNs, { provider: entry.provider }, { timeoutMs: 25000 });
        if (models) models = models.map(model => ({ id: model.id, name: model.name || model.id }));
      } catch {
        models = null;
      }
    }
    providers.push({
      provider: entry.provider,
      name: (preset && preset.label) || entry.displayName || entry.provider,
      displayName: entry.displayName || entry.provider,
      settingsNs: entry.settingsNs,
      settingsPath: entry.settingsPath,
      configured,
      active: isActive,
      builtin: entry.provider === "deepseek-official",
      synthetic: entry.synthetic,
      custom: Boolean((preset && preset.custom) || entry.declared === true || entry.synthetic),
      oauthOnly: Boolean(preset && preset.oauthOnly),
      note: preset ? preset.note : (entry.declared ? "Hand-declared provider route." : ""),
      order: preset ? preset.order : 1000,
      apiKeyEnv: ref,
      key: credential ? {
        configured: credential.configured === true,
        source: credential.source || null,
        writable: credential.writable === true,
      } : { configured: false, source: null, writable: false, required: false },
      baseURL: configured && typeof profile.baseURL === "string" ? profile.baseURL : null,
      api: configured && typeof profile.api === "string" ? profile.api : null,
      models,
      error: entry.error || undefined,
    });
  }
  providers.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const defaultView = namespaceView(describe, "agent-default-model");
  const revisions = Object.fromEntries((describe.namespaces || []).map(view => [view.ns, view.revision]));
  return {
    writable: describe.writable === true,
    providers,
    active: [...activeIds],
    defaultModel: defaultView && defaultView.value ? {
      provider: defaultView.value.provider || null,
      model: defaultView.value.model || null,
      reasoningEffort: defaultView.value.reasoningEffort || null,
    } : null,
    revisions,
    apiProtocols: API_PROTOCOLS,
  };
}

function ensureWritable(describe) {
  if (!describe || describe.writable !== true) {
    throw new HarnessRpcError("The harness settings document is read-only in this deployment", {
      code: "SETTINGS_READONLY",
    });
  }
}

function revisionOf(describe, ns) {
  const view = namespaceView(describe, ns);
  if (!view) throw new HarnessRpcError(`The harness has no settings namespace ${ns}`, { code: "UNKNOWN_NAMESPACE" });
  return view.revision;
}

function normalizeBaseURL(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new HarnessRpcError("Enter a valid HTTP or HTTPS base URL"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HarnessRpcError("The base URL must use HTTP or HTTPS");
  }
  return parsed.href.replace(/\/+$/, "");
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return [];
  const seen = new Set();
  const result = [];
  for (const item of models) {
    const id = typeof item === "string" ? item : item && item.id;
    if (typeof id !== "string" || !id.trim() || seen.has(id.trim())) continue;
    seen.add(id.trim());
    result.push({ id: id.trim() });
  }
  return result;
}

function findDirectoryEntry(directory, provider) {
  return directory.find(entry => entry.provider === provider) || null;
}

/**
 * Add or update a provider profile, then store its key when supplied.
 * @param {object} rpc
 * @param {object} input
 */
async function saveProvider(rpc, input) {
  const provider = String(input.provider || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new HarnessRpcError("Provider IDs use lowercase letters, digits, and hyphens");
  }
  const describe = await rpc.describeSettings();
  ensureWritable(describe);
  const directory = await rpc.listConfigurableProviders();
  const entry = findDirectoryEntry(directory, provider);
  const preset = presetFor(provider);
  const custom = input.custom === true || !entry;
  const ns = entry ? entry.settingsNs : "llm-pi-ai";
  const settingsPath = entry ? [...entry.settingsPath] : ["providers", provider];
  const existing = profileFor(describe, ns, settingsPath) || {};
  const profile = { ...existing };
  const ref = input.apiKeyEnv || (typeof existing.apiKeyEnv === "string" && existing.apiKeyEnv)
    || refFor(provider, preset);
  if (input.oauthOnly !== true) profile.apiKeyEnv = ref;
  if (typeof input.displayName === "string" && input.displayName.trim()) profile.displayName = input.displayName.trim();
  if (input.baseURL) profile.baseURL = normalizeBaseURL(input.baseURL);
  if (input.api) {
    if (!API_PROTOCOLS.includes(input.api)) throw new HarnessRpcError("Choose a supported API protocol");
    profile.api = input.api;
  }
  const models = normalizeModels(input.models || []);
  if (custom || provider === "ollama") {
    if (!profile.baseURL) throw new HarnessRpcError("A custom provider needs a base URL");
    if (!profile.api) throw new HarnessRpcError("A custom provider needs an API protocol");
    if (models.length === 0) throw new HarnessRpcError("A custom provider needs at least one model");
    profile.models = models;
  } else if (models.length > 0 && input.modelsExplicit === true) {
    profile.models = models;
  }
  if (input.oauthOnly === true) delete profile.apiKeyEnv;
  const revision = revisionOf(describe, ns);
  const ops = [{ op: "set", path: settingsPath, value: profile }];
  await rpc.mutateSettings(ns, ops, revision);
  if (typeof input.key === "string" && input.key.trim() && input.oauthOnly !== true) {
    await rpc.setCredential(ref, input.key.trim());
  }
  return refresh(rpc);
}

async function refresh(rpc) {
  return loadProviders(rpc, { discoverActive: true });
}

async function setProviderKey(rpc, { provider, key, apiKeyEnv }) {
  if (typeof key !== "string" || !key.trim()) throw new HarnessRpcError("Enter an API key");
  const describe = await rpc.describeSettings();
  ensureWritable(describe);
  const directory = await rpc.listConfigurableProviders();
  const entry = findDirectoryEntry(directory, provider);
  const preset = presetFor(provider);
  const ns = entry ? entry.settingsNs : "llm-pi-ai";
  const settingsPath = entry ? [...entry.settingsPath] : ["providers", provider];
  const existing = profileFor(describe, ns, settingsPath);
  let ref = apiKeyEnv;
  if (!ref && existing && typeof existing.apiKeyEnv === "string") ref = existing.apiKeyEnv;
  if (!ref) ref = refFor(provider, preset);
  if (!existing) {
    const profile = { apiKeyEnv: ref };
    if (provider === "ollama") {
      profile.api = "openai-completions";
      profile.baseURL = "http://127.0.0.1:11434/v1";
      profile.models = [{ id: "llama3.2" }];
    }
    await rpc.mutateSettings(ns, [{ op: "set", path: settingsPath, value: profile }], revisionOf(describe, ns));
  }
  await rpc.setCredential(ref, key.trim());
  return refresh(rpc);
}

async function removeProviderKey(rpc, { provider, ref }) {
  const describe = await rpc.describeSettings();
  ensureWritable(describe);
  const directory = await rpc.listConfigurableProviders();
  const entry = findDirectoryEntry(directory, provider);
  const preset = presetFor(provider);
  const profile = entry
    ? profileFor(describe, entry.settingsNs, entry.settingsPath)
    : profileFor(describe, "llm-pi-ai", ["providers", provider]);
  const target = ref || (profile && typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : refFor(provider, preset));
  await rpc.unsetCredential(target);
  return refresh(rpc);
}

async function removeProvider(rpc, provider, { removeKey = false } = {}) {
  const describe = await rpc.describeSettings();
  ensureWritable(describe);
  const directory = await rpc.listConfigurableProviders();
  const entry = findDirectoryEntry(directory, provider);
  if (!entry || entry.settingsPath.length === 0) {
    throw new HarnessRpcError("The built-in DeepSeek route cannot be removed");
  }
  const ns = entry.settingsNs;
  const defaultView = namespaceView(describe, "agent-default-model");
  if (defaultView && defaultView.value && defaultView.value.provider === provider) {
    throw new HarnessRpcError("Choose another default model before removing the provider that owns it");
  }
  const profile = profileFor(describe, entry.settingsNs, entry.settingsPath);
  const ref = profile && typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : null;
  await rpc.mutateSettings(ns, [{ op: "unset", path: [...entry.settingsPath] }], revisionOf(describe, ns));
  if (removeKey && ref) {
    try { await rpc.unsetCredential(ref); } catch { /* environment-managed keys cannot be removed */ }
  }
  return refresh(rpc);
}

async function setDefaultModel(rpc, { provider, model, reasoningEffort }) {
  if (typeof provider !== "string" || !provider.trim()) throw new HarnessRpcError("Choose a provider");
  if (typeof model !== "string" || !model.trim()) throw new HarnessRpcError("Choose a model");
  const describe = await rpc.describeSettings();
  ensureWritable(describe);
  const revision = revisionOf(describe, "agent-default-model");
  const ops = [
    { op: "set", path: ["provider"], value: provider.trim() },
    { op: "set", path: ["model"], value: model.trim() },
  ];
  if (typeof reasoningEffort === "string" && reasoningEffort.trim()) {
    ops.push({ op: "set", path: ["reasoningEffort"], value: reasoningEffort.trim() });
  } else {
    ops.push({ op: "unset", path: ["reasoningEffort"] });
  }
  await rpc.mutateSettings("agent-default-model", ops, revision);
  return refresh(rpc);
}

async function discoverModels(rpc, { settingsNs, provider, baseURL, api, apiKey }) {
  const request = {};
  if (provider) request.provider = provider;
  if (baseURL) request.baseURL = normalizeBaseURL(baseURL);
  if (api) request.api = api;
  if (apiKey) request.apiKey = apiKey;
  const models = await rpc.discoverModels(settingsNs || "llm-pi-ai", request, { timeoutMs: 40000 });
  return (models || []).map(model => ({
    id: model.id,
    name: model.name || model.id,
    contextWindow: model.contextWindow || null,
    maxTokens: model.maxTokens || null,
  }));
}

module.exports = {
  API_PROTOCOLS,
  PRESETS,
  deriveRef,
  refFor,
  presetFor,
  loadProviders,
  saveProvider,
  setProviderKey,
  removeProviderKey,
  removeProvider,
  setDefaultModel,
  discoverModels,
  revisionOf,
  normalizeModels,
  normalizeBaseURL,
  readPath,
  profileFor,
};
