import * as React from "react";
import { Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge, unwrap } from "@/lib/bridge";
import { relativeTime } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Badge, Button, Dialog, ErrorBanner, SectionHeader, Switch } from "../ui";

export function UpdatesSection({ state, onRefresh }: { state: AppState; onRefresh: () => Promise<void> }) {
  const api = bridge();
  const action = useAction();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const updates = state.updates;
  const runtime = updates?.harness;
  const progress = updates?.progress;
  const busy = action.busy || Boolean(updates?.busy || updates?.checking || progress);
  const autoCheck = updates?.autoCheck ?? state.prefs.updates.autoCheck;
  const autoUpdate = updates?.autoUpdate ?? state.prefs.updates.autoUpdate;
  const check = () => void action.run(async () => {
    await unwrap(api.updates.check());
    await onRefresh();
  });
  const apply = () => void action.run(async () => {
    setConfirmOpen(false);
    await unwrap(api.updates.apply());
    await onRefresh();
  }, "Private coding runtime verified and started.");
  const policy = (patch: { autoCheck?: boolean; autoUpdate?: boolean }) => void action.run(async () => {
    await api.savePreferences({ updates: { autoCheck, autoUpdate, ...patch } });
    await onRefresh();
  }, "Update preferences saved.");
  React.useEffect(() => { if (!updates?.checkedAt && !progress) check(); }, []);

  return (
    <div className="space-y-6">
      <SectionHeader title="Coding runtime updates" detail="Official published releases, including prereleases, installed only in DeepDeck’s private directory."
        actions={<Button variant="outline" size="sm" disabled={busy} onClick={check}><RefreshCw size={13} />Check now</Button>} />
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">DeepSeek Harness for DeepDeck</h2>
          <Badge tone={runtime?.state === "failed" ? "warning" : runtime?.state === "up-to-date" ? "success" : "muted"}>
            {updates?.busy ? "Preparing coding runtime" : runtime?.state === "failed" ? "Update needs attention" : runtime?.state === "pending" ? "Ready for next launch"
              : runtime?.state === "up-to-date" ? "Up to date" : "Preparing installation"}
          </Badge>
        </div>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-text-faint">Installed version</dt><dd className="mono mt-1">{runtime?.version || state.harness.version || "Not installed"}</dd></div>
          <div><dt className="text-text-faint">Pending release</dt><dd className="mono mt-1">{runtime?.pendingVersion || "None"}</dd></div>
          <div><dt className="text-text-faint">Last checked</dt><dd className="mt-1">{relativeTime(runtime?.checkedAt || null)}</dd></div>
          <div><dt className="text-text-faint">Update timing</dt><dd className="mt-1">{autoUpdate ? "Before Code starts at next launch" : "Install manually"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-text-faint">Private data home</dt><dd className="mono mt-1 break-all">{runtime?.home || "Created during first setup"}</dd></div>
        </dl>
        {runtime?.error && <ErrorBanner message={runtime.error} />}
        {runtime?.migrationWarning && <p role="status" className="text-xs text-warning">{runtime.migrationWarning}</p>}
        {progress && <p role="status" className="flex items-center gap-2 text-xs text-text-muted"><Loader2 size={13} className="animate-spin" />{progress}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={busy || runtime?.canUpdate === false} onClick={() => setConfirmOpen(true)}>
            <Download size={13} />{runtime?.state === "failed" ? "Retry update" : runtime?.version ? "Install now" : "Set up Code"}
          </Button>
          {runtime?.releaseUrl && <Button variant="outline" size="sm" onClick={() => void api.openExternal(runtime.releaseUrl)}>Release notes</Button>}
        </div>
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted"><ShieldCheck size={13} className="mt-0.5 shrink-0" />
          A candidate receives its own runtime and data copy. DeepDeck switches only after the host, native settings,
          presets, and Code page pass verification. Failed candidates leave the working installation intact.
        </p>
      </section>
      <section className="space-y-4 rounded-lg border border-border p-4">
        <Switch checked={autoCheck} label="Check for published harness releases automatically" disabled={busy}
          onChange={value => policy({ autoCheck: value })} />
        <Switch checked={autoUpdate} label="Install pending updates at the next launch" disabled={busy}
          onChange={value => policy({ autoUpdate: value })} />
        <p className="text-[11px] leading-relaxed text-text-muted">Background checks run after launch and every four hours.
          They never restart a running Code session. A failed release requires a manual retry or a newer release.</p>
      </section>
      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-text">DeepDeck desktop shell · {state.version}</h2>
        <p className="text-xs leading-relaxed text-text-muted">{updates?.app?.message || "Pull the DeepDeck source and rerun packaging/install.sh to update the desktop shell."}</p>
        <p className="text-[11px] text-text-faint">Your downloaded harness and the official Harness desktop app are separate installations.</p>
      </section>
      {(action.error || updates?.error) && <ErrorBanner message={action.error || updates?.error || ""} />}
      {action.message && <p role="status" className="text-xs text-success">{action.message}</p>}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Install the private coding runtime?"
        description="Code will stop while DeepDeck prepares and verifies the candidate."
        footer={<><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button variant="primary" onClick={apply}>Install and verify</Button></>}>
        <p className="text-xs leading-relaxed text-text-muted">Finish active Code work first. Chat stays available.
          Installation changes only DeepDeck’s private files; the downloaded harness and official desktop app remain untouched.</p>
      </Dialog>
    </div>
  );
}
