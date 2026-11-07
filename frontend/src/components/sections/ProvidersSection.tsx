import * as React from "react";
import {
  Check, ChevronDown, CircleAlert, KeyRound, Loader2, Plus, RefreshCw, Search, Trash2,
} from "lucide-react";
import type { ModelSummary, ProviderView, ProvidersView } from "@/lib/bridge";
import { bridge, errorMessage, unwrap } from "@/lib/bridge";
import { keyLabel, normalizedModelIds, providerState } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import {
  Badge, Button, Dialog, ErrorBanner, Field, Input, SectionHeader, Select, Textarea, cn,
} from "../ui";

const EFFORTS = [
  { value: "", label: "Model default" },
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

type DialogState =
  | { kind: "add"; preset?: string }
  | { kind: "key"; provider: ProviderView }
  | { kind: "remove"; provider: ProviderView }
  | { kind: "default"; provider?: string }
  | null;

const OPENCODE_BRIDGED = new Set(["mistral", "zai", "minimax", "opencode-go"]);

export function ProvidersSection() {
  const api = bridge();
  const [view, setView] = React.useState<ProvidersView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const action = useAction();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await unwrap(api.providers.list()));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => { void load(); }, [load]);

  if (loading && !view) {
    return (
      <div className="flex items-center gap-2 py-10 text-xs text-text-muted">
        <Loader2 size={14} className="animate-spin text-primary" />Reading providers from the harness…
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={error} onRetry={() => void load()} />
        <p className="text-[11px] text-text-muted">
          The providers page reads the live harness. If the harness is still starting, wait a moment and retry.
        </p>
        <Button variant="outline" size="sm" onClick={() => void action.run(async () => { await unwrap(api.harness.restart()); await load(); })}>
          <RefreshCw size={13} />Restart harness
        </Button>
      </div>
    );
  }

  if (!view) return null;

  const query = search.trim().toLowerCase();
  const matches = (provider: ProviderView) =>
    !query || provider.name.toLowerCase().includes(query) || provider.provider.toLowerCase().includes(query);
  const configured = view.providers.filter(provider => matches(provider) && (provider.active || provider.configured));
  const available = view.providers.filter(provider => matches(provider) && !provider.active && !provider.configured);
  const defaultModel = view.defaultModel;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Routes and keys"
        detail="These are the harness's own provider routes and credentials. Changes apply live through the host API; the composer model picker uses the same state."
        actions={
          <>
            <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void load()}>
              <RefreshCw size={13} className={action.busy ? "animate-spin" : ""} />Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => setDialog({ kind: "add" })}>
              <Plus size={13} />Add provider
            </Button>
          </>
        }
      />

      {!view.writable && (
        <div className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          The harness settings document is read-only in this deployment. Provider edits are disabled.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text">Default model</span>
            {defaultModel ? (
              <Badge tone="primary">
                {view.providers.find(provider => provider.provider === defaultModel.provider)?.name || defaultModel.provider}
                <span className="mono ml-1 font-normal">{defaultModel.model}</span>
              </Badge>
            ) : <Badge>not set</Badge>}
            {defaultModel?.reasoningEffort && <Badge>effort {defaultModel.reasoningEffort}</Badge>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "default", provider: defaultModel?.provider || undefined })}>
              Change default
            </Button>
          </div>
        </div>
        <div className="px-4 py-2.5 text-[11px] leading-relaxed text-text-muted">
          New sessions start on this route. Existing sessions keep the model recorded in their own log, and the harness
          model picker can change it per session.
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-text-faint" />
        <Input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Filter providers…"
          aria-label="Filter providers"
          className="pl-7"
        />
      </div>

      {configured.length > 0 && (
        <ProviderGroup title="Configured and active" count={configured.length}>
          {configured.map(provider => (
            <ProviderRow
              key={provider.provider}
              provider={provider}
              onKey={() => setDialog({ kind: "key", provider })}
              onRemove={() => setDialog({ kind: "remove", provider })}
              onDefault={() => setDialog({ kind: "default", provider: provider.provider })}
            />
          ))}
        </ProviderGroup>
      )}

      {available.length > 0 && (
        <ProviderGroup title="Available in the harness catalog" count={available.length}>
          {available.map(provider => (
            <ProviderRow
              key={provider.provider}
              provider={provider}
              onKey={() => setDialog({ kind: "key", provider })}
              onRemove={() => setDialog({ kind: "remove", provider })}
              onDefault={() => setDialog({ kind: "default", provider: provider.provider })}
            />
          ))}
        </ProviderGroup>
      )}

      {configured.length === 0 && available.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
          No provider matches “{search}”.
        </p>
      )}

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {action.error && <ErrorBanner message={action.error} />}
      {(message || action.message) && <p role="status" className="text-[11px] text-success">{message || action.message}</p>}

      <AddProviderDialog
        open={dialog?.kind === "add"}
        view={view}
        onClose={() => setDialog(null)}
        onSaved={next => { setView(next); setDialog(null); setMessage("Provider saved."); }}
      />
      <KeyDialog
        open={dialog?.kind === "key"}
        provider={dialog?.kind === "key" ? dialog.provider : null}
        onClose={() => setDialog(null)}
        onSaved={next => { setView(next); setDialog(null); setMessage("Credential updated."); }}
      />
      <DefaultDialog
        open={dialog?.kind === "default"}
        view={view}
        providerId={dialog?.kind === "default" ? dialog.provider : undefined}
        onClose={() => setDialog(null)}
        onSaved={next => { setView(next); setDialog(null); setMessage("Default model updated."); }}
      />
      <RemoveDialog
        open={dialog?.kind === "remove"}
        provider={dialog?.kind === "remove" ? dialog.provider : null}
        onClose={() => setDialog(null)}
        onSaved={next => { setView(next); setDialog(null); setMessage("Provider removed."); }}
      />
    </div>
  );
}

function ProviderGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{title}</h3>
        <span className="tabular text-[10px] text-text-faint">{count}</span>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{children}</div>
    </section>
  );
}

function ProviderRow({
  provider, onKey, onRemove, onDefault,
}: {
  provider: ProviderView;
  onKey: () => void;
  onRemove: () => void;
  onDefault: () => void;
}) {
  const status = providerState(provider);
  return (
    <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          provider.active ? "bg-success" : provider.configured ? "bg-warning" : "bg-text-faint/40",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-text">{provider.name}</span>
          <span className="mono text-[10px] text-text-faint">{provider.provider}</span>
          {provider.builtin && <Badge>Built-in</Badge>}
          {provider.oauthOnly && <Badge tone="warning">OAuth</Badge>}
          {provider.custom && <Badge>Custom route</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
          <span className={cn(provider.key.configured ? "text-success" : provider.oauthOnly ? "text-text-faint" : "text-warning")}>
            {provider.oauthOnly
              ? "Native authentication"
              : provider.key.source === "env" && OPENCODE_BRIDGED.has(provider.provider)
                ? "From OpenCode auth"
                : keyLabel(provider.key)}
          </span>
          <span className="mono text-text-faint">{provider.apiKeyEnv}</span>
          {provider.models && <span>{provider.models.length} model{provider.models.length === 1 ? "" : "s"}</span>}
          {provider.baseURL && <span className="mono break-all">{provider.baseURL}</span>}
        </div>
        {provider.error && <p className="mt-1 break-words text-[10px] text-danger">{provider.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Badge tone={status.tone === "success" ? "success" : status.tone === "warning" ? "warning" : "muted"}>{status.label}</Badge>
        <Button variant="ghost" size="sm" aria-label={`Use ${provider.name}`} onClick={onDefault} disabled={!provider.active && !provider.configured}>Use</Button>
        {!provider.oauthOnly && <Button variant="outline" size="sm" aria-label={`Manage key for ${provider.name}`} onClick={onKey}><KeyRound size={12} />Key</Button>}
        {!provider.builtin && (
          <Button variant="ghost" size="icon" aria-label={`Remove ${provider.name}`} title="Remove provider" onClick={onRemove}>
            <Trash2 size={13} className="text-danger" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AddProviderDialog({
  open, view, onClose, onSaved,
}: {
  open: boolean;
  view: ProvidersView;
  onClose: () => void;
  onSaved: (view: ProvidersView) => void;
}) {
  const api = bridge();
  const action = useAction();
  const [step, setStep] = React.useState<"pick" | "edit">("pick");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<ProviderView | null>(null);
  const [providerId, setProviderId] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [baseURL, setBaseURL] = React.useState("");
  const [protocol, setProtocol] = React.useState("openai-completions");
  const [models, setModels] = React.useState("");
  const [discovered, setDiscovered] = React.useState<ModelSummary[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setStep("pick");
    setSearch("");
    setSelected(null);
    setProviderId("");
    setDisplayName("");
    setKey("");
    setBaseURL("");
    setProtocol("openai-completions");
    setModels("");
    setDiscovered([]);
    action.setError(null);
  }, [open]);

  const choose = (provider: ProviderView | null) => {
    setSelected(provider);
    setProviderId(provider?.provider || "");
    setDisplayName(provider?.name || "");
    setKey("");
    setBaseURL(provider?.baseURL || "");
    setProtocol(provider?.api || "openai-completions");
    setModels("");
    setDiscovered([]);
    setStep("edit");
    action.setError(null);
  };

  const custom = !selected;
  const needEndpoint = custom || (selected?.custom ?? false);
  const query = search.trim().toLowerCase();
  const options = view.providers
    .filter(provider => !query || provider.name.toLowerCase().includes(query) || provider.provider.toLowerCase().includes(query))
    .slice(0, 80);

  const discover = () => void action.run(async () => {
    const result = await unwrap(api.providers.discover({
      settingsNs: selected?.settingsNs || "llm-pi-ai",
      provider: selected?.provider || undefined,
      baseURL: baseURL || undefined,
      api: needEndpoint ? protocol : undefined,
      apiKey: key || undefined,
    }));
    setDiscovered(result);
    if (result.length === 0) action.setError("The endpoint listed no models. Add model IDs manually.");
  });

  const save = () => void action.run(async () => {
    const ids = normalizedModelIds(models);
    const input: Record<string, unknown> = {
      provider: providerId.trim(),
      custom,
      displayName: displayName.trim() || undefined,
      key: key.trim() || undefined,
      baseURL: needEndpoint ? baseURL.trim() : (baseURL.trim() || undefined),
      api: needEndpoint ? protocol : undefined,
      models: ids,
      modelsExplicit: ids.length > 0,
      oauthOnly: selected?.oauthOnly === true,
    };
    const next = await unwrap(api.providers.save(input));
    onSaved(next);
  });

  const footer = step === "pick" ? (
    <Button variant="ghost" onClick={onClose}>Cancel</Button>
  ) : (
    <>
      <Button variant="ghost" onClick={() => setStep("pick")}>Back</Button>
      <Button variant="outline" onClick={discover} disabled={action.busy}>Load models</Button>
      <Button variant="primary" disabled={action.busy || !providerId.trim() || (!selected?.oauthOnly && !key.trim() && !view.providers.find(p => p.provider === providerId)?.key.configured && !needEndpoint)} onClick={save}>
        {action.busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Save provider
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={step === "pick" ? "Add a provider" : custom ? "Custom provider" : `Configure ${selected?.name || providerId}`}
      description={step === "pick"
        ? "Choose a harness-catalog provider, or declare a custom OpenAI-compatible or Anthropic-compatible endpoint."
        : "The provider route and model catalog come from the harness. Credentials are stored write-only."}
      size="lg"
      footer={footer}
    >
      {step === "pick" ? (
        <div className="space-y-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-text-faint" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search providers…" className="pl-7" aria-label="Search providers" />
          </div>
          <div className="max-h-[46vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
            <button
              type="button"
              onClick={() => choose(null)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
            >
              <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/10 text-primary"><Plus size={14} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-text">Custom provider</span>
                <span className="block text-[10px] text-text-muted">Declare an endpoint, protocol, and model list</span>
              </span>
              <ChevronDown size={13} className="-rotate-90 text-text-faint" />
            </button>
            {options.map(provider => (
              <button
                key={provider.provider}
                type="button"
                onClick={() => choose(provider)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
              >
                <span className={cn("h-2 w-2 rounded-full", provider.active ? "bg-success" : provider.configured ? "bg-warning" : "bg-text-faint/40")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-text">{provider.name} <span className="mono ml-1 text-[10px] font-normal text-text-faint">{provider.provider}</span></span>
                  <span className="block truncate text-[10px] text-text-muted">
                    {provider.active ? "Active route" : provider.configured ? "Configured" : "Available"}
                    {provider.key.configured ? " · key present" : ""}
                  </span>
                </span>
              </button>
            ))}
            {options.length === 0 && <p className="px-3 py-6 text-center text-xs text-text-muted">No provider matches.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!custom && selected && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <div>
                <p className="text-xs font-medium text-text">{selected.name}</p>
                <p className="mono text-[10px] text-text-faint">{selected.provider} · {selected.settingsNs}</p>
              </div>
              <Badge tone={selected.active ? "success" : selected.configured ? "warning" : "muted"}>
                {selected.active ? "Active" : selected.configured ? "Configured" : "Available"}
              </Badge>
            </div>
          )}
          {custom && (
            <>
              <Field label="Provider ID" hint="Lowercase letters, digits, and hyphens. This becomes the settings key.">
                <Input value={providerId} onChange={event => setProviderId(event.target.value)} placeholder="my-gateway" className="mono" autoFocus />
              </Field>
              <Field label="Display name">
                <Input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="My gateway" />
              </Field>
            </>
          )}
          {!selected?.oauthOnly && (
            <Field
              label="API key"
              hint={selected?.key.configured
                ? `A key is already ${selected.key.source === "env" ? "provided by the environment" : "stored"}. Leave blank to keep it.`
                : "Stored write-only in the harness credential store. Never shown back."}
            >
              <Input
                type="password"
                value={key}
                onChange={event => setKey(event.target.value)}
                placeholder={selected?.key.configured ? "Replace key…" : "Paste API key…"}
                autoComplete="off"
              />
            </Field>
          )}
          {needEndpoint && (
            <>
              <Field label="Base URL" hint="HTTP or HTTPS. Ollama typically uses http://127.0.0.1:11434/v1.">
                <Input value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://gateway.example/v1" className="mono" />
              </Field>
              <Field label="API protocol">
                <Select
                  value={protocol}
                  onChange={event => setProtocol(event.target.value)}
                  options={view.apiProtocols.map(value => ({ value, label: value }))}
                />
              </Field>
              <Field label="Models" hint="One model ID per line, or comma-separated. Required for a hand-declared route.">
                <Textarea rows={4} value={models} onChange={event => setModels(event.target.value)} placeholder={"model-id\nanother-model"} className="mono" />
              </Field>
              {discovered.length > 0 && (
                <div className="rounded-md border border-border bg-muted/30 p-2">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-faint">Discovered models</p>
                  <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                    {discovered.map(model => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => setModels(current => {
                          const ids = normalizedModelIds(`${current}\n${model.id}`);
                          return ids.join("\n");
                        })}
                        className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-text-muted hover:border-primary/40 hover:text-text"
                      >
                        {model.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {!needEndpoint && (
            <Field label="Base URL override" hint="Optional. Leave blank to use the catalog endpoint.">
              <Input value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder={selected?.baseURL || "Catalog default"} className="mono" />
            </Field>
          )}
          {selected?.note && <p className="text-[11px] leading-relaxed text-text-faint">{selected.note}</p>}
          {action.error && <ErrorBanner message={action.error} />}
        </div>
      )}
    </Dialog>
  );
}

function KeyDialog({
  open, provider, onClose, onSaved,
}: {
  open: boolean;
  provider: ProviderView | null;
  onClose: () => void;
  onSaved: (view: ProvidersView) => void;
}) {
  const api = bridge();
  const action = useAction();
  const [key, setKey] = React.useState("");
  React.useEffect(() => { setKey(""); action.setError(null); }, [open, provider?.provider]);

  if (!provider) return null;
  const managed = provider.key.source === "env" || !provider.key.writable;

  const save = () => void action.run(async () => {
    onSaved(await unwrap(api.providers.setKey({ provider: provider.provider, key, apiKeyEnv: provider.apiKeyEnv })));
  });
  const remove = () => void action.run(async () => {
    onSaved(await unwrap(api.providers.removeKey({ provider: provider.provider, ref: provider.apiKeyEnv })));
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${provider.name} credential`}
      description={`${provider.provider} · reference ${provider.apiKeyEnv}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {provider.key.configured && !managed && <Button variant="danger" disabled={action.busy} onClick={remove}>Remove key</Button>}
          <Button variant="primary" disabled={action.busy || !key.trim() || managed} onClick={save}>
            {action.busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}Save key
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
          <span className="text-[11px] text-text-muted">{managed ? "Managed outside the harness store" : keyLabel(provider.key)}</span>
          <Badge tone={provider.key.configured ? "success" : "warning"}>{provider.key.configured ? "Configured" : "Missing"}</Badge>
        </div>
        {managed ? (
          <p className="text-[11px] leading-relaxed text-text-muted">
            This reference comes from the DeepDeck launch environment and is read-only here. For Mistral, Z.ai, MiniMax,
            and OpenCode Go, DeepDeck fills it from <span className="mono">~/.local/share/opencode/auth.json</span>.
            Rotate the key in OpenCode (or export the variable before launch), then restart the harness.
          </p>
        ) : (
          <Field label="API key" hint="Written to the harness credential store with mode 0600; never shown again.">
            <Input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder="Paste API key…" autoComplete="off" autoFocus />
          </Field>
        )}
        {action.error && <ErrorBanner message={action.error} />}
      </div>
    </Dialog>
  );
}

function DefaultDialog({
  open, view, providerId, onClose, onSaved,
}: {
  open: boolean;
  view: ProvidersView;
  providerId?: string;
  onClose: () => void;
  onSaved: (view: ProvidersView) => void;
}) {
  const api = bridge();
  const action = useAction();
  const usable = view.providers.filter(provider => provider.active || provider.configured);
  const [selectedProvider, setSelectedProvider] = React.useState(providerId || usable[0]?.provider || "");
  const [model, setModel] = React.useState("");
  const [effort, setEffort] = React.useState("");
  const [models, setModels] = React.useState<ModelSummary[] | null>(null);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const initial = providerId || usable[0]?.provider || "";
    setSelectedProvider(initial);
    const found = usable.find(provider => provider.provider === initial);
    setModels(found?.models || null);
    setModel(view.defaultModel?.provider === initial ? view.defaultModel.model || "" : (found?.models?.[0]?.id || ""));
    setEffort(view.defaultModel?.provider === initial ? view.defaultModel.reasoningEffort || "" : "");
    setError(null);
  }, [open, providerId]);

  const loadModels = React.useCallback(async (providerName: string) => {
    const provider = usable.find(entry => entry.provider === providerName);
    if (!provider) return;
    if (provider.models) { setModels(provider.models); return; }
    setLoadingModels(true);
    setError(null);
    try {
      const found = await unwrap(api.providers.discover({ settingsNs: provider.settingsNs, provider: provider.provider }));
      setModels(found);
      if (found.length > 0) setModel(current => current || found[0].id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingModels(false);
    }
  }, [api, usable]);

  React.useEffect(() => {
    if (!open || !selectedProvider) return;
    const provider = usable.find(entry => entry.provider === selectedProvider);
    if (provider?.models) { setModels(provider.models); return; }
    void loadModels(selectedProvider);
  }, [open, selectedProvider]);

  const save = () => void action.run(async () => {
    onSaved(await unwrap(api.providers.setDefault({
      provider: selectedProvider,
      model: model.trim(),
      reasoningEffort: effort || null,
    })));
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Default model"
      description="Applied to new sessions. Existing sessions keep their recorded route."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={action.busy || !selectedProvider || !model.trim()} onClick={save}>Save default</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Provider">
          <Select
            value={selectedProvider}
            onChange={event => {
              const next = event.target.value;
              setSelectedProvider(next);
              const provider = usable.find(entry => entry.provider === next);
              setModel(provider?.models?.[0]?.id || "");
              setModels(provider?.models || null);
              setEffort("");
            }}
            options={usable.map(provider => ({ value: provider.provider, label: `${provider.name} (${provider.provider})` }))}
          />
        </Field>
        <Field label="Model" hint={loadingModels ? "Loading the catalog…" : models ? `${models.length} models available` : "Enter a model ID or load the catalog."}>
          {models && models.length > 0 ? (
            <Select
              value={model}
              onChange={event => setModel(event.target.value)}
              options={models.map(item => ({ value: item.id, label: item.name === item.id ? item.id : `${item.name} · ${item.id}` }))}
            />
          ) : (
            <Input value={model} onChange={event => setModel(event.target.value)} placeholder="model-id" className="mono" />
          )}
        </Field>
        <Field label="Reasoning effort" hint="Leave at model default unless you know the route supports the level.">
          <Select value={effort} onChange={event => setEffort(event.target.value)} options={EFFORTS} />
        </Field>
        {(error || action.error) && <ErrorBanner message={error || action.error || ""} />}
      </div>
    </Dialog>
  );
}

function RemoveDialog({
  open, provider, onClose, onSaved,
}: {
  open: boolean;
  provider: ProviderView | null;
  onClose: () => void;
  onSaved: (view: ProvidersView) => void;
}) {
  const api = bridge();
  const action = useAction();
  const [removeKey, setRemoveKey] = React.useState(false);
  React.useEffect(() => { setRemoveKey(false); action.setError(null); }, [open, provider?.provider]);
  if (!provider) return null;

  const save = () => void action.run(async () => {
    onSaved(await unwrap(api.providers.remove(provider.provider, removeKey)));
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Remove ${provider.name}?`}
      description={`This removes the ${provider.provider} route from the harness user settings. Sessions keep their recorded history.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={action.busy} onClick={save}>Remove provider</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
          <input type="checkbox" className="mt-0.5" checked={removeKey} onChange={event => setRemoveKey(event.target.checked)} />
          Also remove the stored credential <span className="mono">{provider.apiKeyEnv}</span> when the harness store owns it.
        </label>
        {provider.error && <p className="flex items-start gap-1.5 text-[11px] text-danger"><CircleAlert size={12} className="mt-0.5" />{provider.error}</p>}
        {action.error && <ErrorBanner message={action.error} />}
      </div>
    </Dialog>
  );
}
