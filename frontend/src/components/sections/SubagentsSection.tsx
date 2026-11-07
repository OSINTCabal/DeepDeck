import * as React from "react";
import {
  AlertTriangle, Check, Cpu, Download, Loader2, RefreshCw, Search, Sparkles, Trash2,
} from "lucide-react";
import type { ProgressEvent, SubagentsView } from "@/lib/bridge";
import { bridge, errorMessage, unwrap } from "@/lib/bridge";
import { useAction } from "@/lib/useAction";
import {
  Badge, Button, Dialog, ErrorBanner, Input, SectionHeader, Switch, cn,
} from "../ui";

function keyOf(provider: string, model: string) {
  return `${provider}\u0000${model}`;
}

export function SubagentsSection() {
  const api = bridge();
  const [view, setView] = React.useState<SubagentsView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [showPicker, setShowPicker] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<ProgressEvent | null>(null);
  const [dialog, setDialog] = React.useState<null | { kind: "install" | "preset" | "remove-preset"; backend?: string }>(null);
  const [installOptions, setInstallOptions] = React.useState({ createPreset: true, setDefault: true });
  const action = useAction();

  const adopt = React.useCallback((next: SubagentsView) => {
    setView(next);
    setEnabled(next.enabled);
    setSelected(new Set(next.allowedModels.map(route => keyOf(route.provider, route.model))));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      adopt(await unwrap(api.subagents.list()));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, adopt]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => api.subagents.onProgress(setProgress), [api]);

  if (loading && !view) {
    return <div className="flex items-center gap-2 py-10 text-xs text-text-muted"><Loader2 size={14} className="animate-spin text-primary" />Reading subagent settings…</div>;
  }
  if (error && !view) {
    return <div className="space-y-3"><ErrorBanner message={error} onRetry={() => void load()} /></div>;
  }
  if (!view) return null;

  const grouped = new Map<string, { name: string; items: Array<{ provider: string; providerName: string; model: string; modelName: string }> }>();
  const query = search.trim().toLowerCase();
  for (const candidate of view.candidates) {
    if (query && !candidate.model.toLowerCase().includes(query) && !candidate.modelName.toLowerCase().includes(query)
      && !candidate.providerName.toLowerCase().includes(query)) continue;
    const group = grouped.get(candidate.provider) || { name: candidate.providerName, items: [] };
    group.items.push(candidate);
    grouped.set(candidate.provider, group);
  }

  const toggle = (provider: string, model: string) => {
    setSelected(current => {
      const next = new Set(current);
      const key = keyOf(provider, model);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = () => void action.run(async () => {
    const allowedModels = [...selected].map(key => {
      const [provider, model] = key.split("\u0000");
      return { provider, model };
    });
    adopt(await unwrap(api.subagents.save({ enabled, allowedModels })));
    setMessage("Subagent model selection saved. New sessions pick up the change.");
  });

  const install = (backend: string) => void action.run(async () => {
    setDialog(null);
    const next = await unwrap(api.subagents.install(backend, installOptions));
    adopt(next);
    setMessage(`${backend} ready in DeepDeck’s private profile.`);
    setProgress(null);
  });

  const removeBackend = (backend: string) => void action.run(async () => {
    setDialog(null);
    adopt(await unwrap(api.subagents.uninstall(backend)));
    setMessage(`${backend} install removed.`);
    setProgress(null);
  });

  const createPreset = () => void action.run(async () => {
    setDialog(null);
    const installed = view.backends.filter(backend => backend.bundleActive).map(backend => backend.kind);
    await unwrap(api.subagents.createPreset(installed));
    await load();
    setMessage("DeepDeck agent preset created and set as the new-session default.");
  });

  const removePreset = () => void action.run(async () => {
    setDialog(null);
    adopt(await unwrap(api.subagents.removePreset()));
    setMessage("DeepDeck preset removed. New sessions use the standard preset.");
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Delegation"
        detail="The harness delegates to child agents through tools composed by an agent preset. The built-in spawn and fork backends need no installation."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void action.run(async () => {
              const result = await unwrap(api.harness.openSettings("plugins"));
              if (!result.opened) throw new Error(result.reason || "Open Settings → Plugins in the harness.");
            }, "Opened the harness Plugins settings.")}>
              <Sparkles size={13} />Harness Plugins
            </Button>
            <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void load()}><RefreshCw size={13} />Refresh</Button>
          </>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {view.builtIn.map(backend => (
          <div key={backend.provider} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-medium text-text"><Cpu size={13} className="text-primary" />{backend.label}</span>
              <Badge tone="success">{backend.mode}</Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{backend.detail}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-medium text-text">Model-selectable delegation</p>
            <p className="text-[11px] text-text-muted">Allows a parent agent to choose an exact route for a child in new sessions.</p>
          </div>
          <Switch
            checked={enabled}
            disabled={!view.writable || action.busy}
            onChange={value => { setEnabled(value); if (value) setShowPicker(true); }}
            label="Enable subagent model selection"
          />
        </div>
        {!enabled && !showPicker && selected.size === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-[11px] text-text-muted">
              Model selection is off. Turn it on, or choose routes now and save them for later.
            </p>
            <Button variant="outline" size="sm" disabled={!view.writable || action.busy} onClick={() => setShowPicker(true)}>
              Choose models
            </Button>
          </div>
        ) : (
        <div className="space-y-3 px-4 py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-text-faint" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter models…" className="pl-7" aria-label="Filter subagent models" />
          </div>
          {view.candidates.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[11px] text-text-muted">
              No active provider models are available. Configure a provider under Providers first.
            </p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {[...grouped.entries()].map(([provider, group]) => (
                <div key={provider}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-faint">{group.name} <span className="mono font-normal">{provider}</span></p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {group.items.map(candidate => {
                      const key = keyOf(candidate.provider, candidate.model);
                      const isSelected = selected.has(key);
                      return (
                        <label
                          key={key}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
                            isSelected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50",
                          )}
                        >
                          <input type="checkbox" checked={isSelected} onChange={() => toggle(candidate.provider, candidate.model)} disabled={!view.writable} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-text">{candidate.modelName}</span>
                            <span className="mono block truncate text-[10px] text-text-faint">{candidate.model}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {enabled && selected.size === 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-warning"><AlertTriangle size={12} />Select at least one allowed model before enabling.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" disabled={!view.writable || action.busy || (enabled && selected.size === 0)} onClick={save}>
              {action.busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Save subagents
            </Button>
            <span className="text-[11px] text-text-muted">{selected.size} allowed route{selected.size === 1 ? "" : "s"}</span>
            <span className="text-[11px] text-text-faint">Applies to new sessions only.</span>
          </div>
        </div>
        )}
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Optional product backends</h3>
          <Button variant="ghost" size="sm" disabled={action.busy} onClick={() => setDialog({ kind: "preset" })}>Create DeepDeck preset</Button>
        </div>
        <p className="mb-2 text-[10px] leading-relaxed text-text-faint">
          Optional backend versions are pinned to this harness release. The harness Plugins page shows the same status
          and can update them too.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {view.backends.map(backend => {
            const incompatible = backend.installed && backend.compatible === false;
            return (
              <div key={backend.kind} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-text">{backend.label}</p>
                    <p className="mono text-[10px] text-text-faint">{backend.package}</p>
                  </div>
                  <Badge tone={incompatible || (backend.installed && !backend.bundleActive) ? "warning" : backend.installed ? "success" : "muted"}>
                    {!backend.installed ? "Not installed" : incompatible ? "Update required" : backend.bundleActive ? "Active" : "Installed · inactive"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{backend.authHint}</p>
                {incompatible ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-warning">
                    Installed {backend.version || "an older release"} for harness {backend.runtimeVersion || "this runtime"}.
                    The harness is skipping it until it is updated.
                  </p>
                ) : backend.installed && !backend.bundleActive ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-warning">
                    {backend.error || "This backend is installed but its bundle is not enabled."}
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-text-faint">{backend.nativeAuth ? "Native account detected" : "Native sign-in may be required on first use"}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {!backend.installed ? (
                    <Button variant="outline" size="sm" disabled={action.busy} onClick={() => setDialog({ kind: "install", backend: backend.kind })}>
                      <Download size={12} />Install
                    </Button>
                  ) : incompatible ? (
                    <>
                      <Button variant="outline" size="sm" disabled={action.busy} onClick={() => setDialog({ kind: "install", backend: backend.kind })}>
                        <Download size={12} />Update
                      </Button>
                      <Button variant="ghost" size="sm" disabled={action.busy} onClick={() => removeBackend(backend.kind)}>
                        <Trash2 size={12} />Remove
                      </Button>
                    </>
                  ) : backend.bundleActive ? (
                    <Button variant="outline" size="sm" disabled={action.busy} onClick={() => setDialog({ kind: "preset" })}>
                      <Cpu size={12} />Compose preset
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" disabled={action.busy} onClick={() => setDialog({ kind: "install", backend: backend.kind })}>Enable</Button>
                      <Button variant="ghost" size="sm" disabled={action.busy} onClick={() => removeBackend(backend.kind)}><Trash2 size={12} />Remove</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-text-muted">
          <span>{view.preset.deepdeckFull ? "Default preset:" : "Preset:"}</span>
          <span className="mono">{view.preset.default || "standard"}</span>
          {view.preset.deepdeckFull && <Badge tone="primary">DeepDeck Full</Badge>}
          {view.preset.deepdeckFull && (
            <Button variant="ghost" size="sm" className="ml-auto text-danger" disabled={action.busy} onClick={() => setDialog({ kind: "remove-preset" })}>
              <Trash2 size={12} />Remove preset
            </Button>
          )}
        </div>
      </section>

      {view.preset.broken && <ErrorBanner message={view.preset.broken} />}
      {progress && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="flex items-center gap-2 text-[11px] text-text"><Loader2 size={12} className="animate-spin text-primary" />{progress.phase}</p>
          <p className="mono mt-1 max-h-24 overflow-y-auto break-words text-[10px] text-text-faint">{progress.message}</p>
        </div>
      )}

      {action.error && <ErrorBanner message={action.error} />}
      {(message || action.message) && <p role="status" className="text-[11px] text-success">{message || action.message}</p>}

      <Dialog
        open={dialog?.kind === "install"}
        onClose={() => setDialog(null)}
        title={`${dialog?.kind === "install" && view.backends.find(backend => backend.kind === dialog.backend)?.installed ? "Update" : "Install"} ${dialog?.kind === "install" ? view.backends.find(backend => backend.kind === dialog.backend)?.label : "subagent"} backend`}
        description="DeepDeck stops the managed harness, installs or updates the backend bundle in the web profile, then restarts it. This needs network access and a harness that can resolve packages."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={action.busy} onClick={() => dialog?.kind === "install" && dialog.backend && install(dialog.backend)}>
              {dialog?.kind === "install" && view.backends.find(backend => backend.kind === dialog.backend)?.installed ? "Update and restart" : "Install and restart"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-[11px] text-text-muted">
            <input type="checkbox" className="mt-0.5" checked={installOptions.createPreset} onChange={event => setInstallOptions(options => ({ ...options, createPreset: event.target.checked }))} />
            Create a DeepDeck Full preset from the current Standard composition.
          </label>
          <label className="flex items-start gap-2 text-[11px] text-text-muted">
            <input type="checkbox" className="mt-0.5" checked={installOptions.setDefault} onChange={event => setInstallOptions(options => ({ ...options, setDefault: event.target.checked }))} />
            Set DeepDeck Full as the default preset for new sessions.
          </label>
          <p className="text-[11px] leading-relaxed text-text-faint">
            Native Codex or Claude Code authentication remains authoritative. The bundle supplies its own pinned runtime;
            the host CLI is not used. DeepDeck verifies that the installed package declares a harness profile bundle before
            creating a preset; older registry builds do not, and are reported as inactive. A failed install restarts the
            previous harness state without changing the default preset.
          </p>
          {action.error && <ErrorBanner message={action.error} />}
        </div>
      </Dialog>

      <Dialog
        open={dialog?.kind === "preset"}
        onClose={() => setDialog(null)}
        title="Create the DeepDeck Full preset"
        description="Registers a private preset bundle based on the current Standard preset. Enabled backend bundles supply their tools. Existing private preset files are backed up."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={action.busy} onClick={createPreset}>Create preset</Button>
          </>
        }
      >
        <p className="text-[11px] leading-relaxed text-text-muted">
          The preset becomes the default for new sessions. Existing sessions keep their composition. You can remove the
          preset later; the installed bundles stay in the profile.
        </p>
      </Dialog>

      <Dialog
        open={dialog?.kind === "remove-preset"}
        onClose={() => setDialog(null)}
        title="Remove the DeepDeck Full preset?"
        description="Removes DeepDeck’s private preset bundle and restores Standard for new sessions. The original harness is unchanged."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" disabled={action.busy} onClick={removePreset}>Remove preset</Button>
          </>
        }
      >
        <p className="text-[11px] leading-relaxed text-text-muted">Installed backend bundles are not removed.</p>
      </Dialog>
    </div>
  );
}
