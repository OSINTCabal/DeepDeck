import { ExternalLink, FolderOpen, Loader2, RefreshCw, RotateCw, TerminalSquare } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge, unwrap } from "@/lib/bridge";
import { harnessStepLabel, shortPath } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Badge, Button, ErrorBanner, SectionHeader } from "../ui";

export function HarnessSection({ state, onRefresh }: { state: AppState; onRefresh: () => Promise<void> }) {
  const api = bridge();
  const action = useAction();
  const harness = state.harness;

  const restart = () => void action.run(async () => {
    await unwrap(api.harness.restart());
    await onRefresh();
  }, harness.state === "ready" ? "Harness restarted." : "Harness started.");

  const openPlugins = async () => {
    const result = await action.run(async () => unwrap(api.harness.openSettings("plugins")));
    if (result && result.opened === false) {
      action.setError(result.reason || "Open Plugins in the harness sidebar.");
    } else {
      action.setMessage("Opened Plugins in Code.");
      await onRefresh();
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Managed harness"
        detail="DeepDeck runs its own packaged harness with private settings, sessions, plugins, and caches. It stops when the app quits."
        actions={
          <Badge tone={harness.state === "ready" ? "success" : harness.state === "error" ? "danger" : (harness.state === "preparing" || harness.state === "starting") ? "warning" : "muted"}>
            {harnessStepLabel(harness.state)}
          </Badge>
        }
      />

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Row label="Status" value={harness.state} mono />
        <Row label="Port" value={harness.port ? String(harness.port) : "not assigned"} mono />
        <Row label="Process" value={harness.pid ? String(harness.pid) : "none"} mono />
        <Row label="Launch kind" value={harness.kind || "auto"} mono />
        <Row label="Working directory" value={shortPath(harness.workdir, 64)} mono wide />
        <Row label="Version" value={harness.version || "not installed"} mono />
        <Row label="Runtime" value={shortPath(harness.runtimeDir || "not installed", 64)} mono wide />
        <Row label="Private data" value={shortPath(harness.home || "not installed", 64)} mono wide />
        <Row label="Started" value={state.harness.startedAt ? new Date(state.harness.startedAt).toLocaleString() : "—"} wide />
        <Row label="Log" value={shortPath(state.paths.harnessLog, 64)} mono wide />
      </div>

      {harness.error && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 p-3">
          <p className="text-xs font-medium text-danger">Harness error</p>
          <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-muted">{harness.error}</pre>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={action.busy || (harness.state === "preparing" || harness.state === "starting")} onClick={restart}>
          {action.busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
          {harness.state === "ready" ? "Restart harness" : "Start harness"}
        </Button>
        <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void action.run(async () => {
          await unwrap(api.harness.reload());
          await onRefresh();
        }, "Active view reloaded.")}>
          <RefreshCw size={13} />Reload view
        </Button>
        <Button variant="outline" size="sm" onClick={() => void api.harness.openLog()}>
          <TerminalSquare size={13} />Open log
        </Button>
        <Button variant="outline" size="sm" onClick={() => void api.harness.openConfigFolder()}>
          <FolderOpen size={13} />Open data folder
        </Button>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="text-xs font-medium text-text">Harness configuration</p>
        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
          Models, provider routes, plugins, and agent presets stay in the harness UI. Use the composer's model, mode,
          and workspace pickers, or open the Plugins page. DeepDeck's Providers and Subagents pages call the same host
          APIs, so either surface shows the same state.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={harness.state !== "ready"} onClick={() => void openPlugins()}>
            <ExternalLink size={13} />Open Plugins
          </Button>
        </div>
      </div>

      {action.error && <ErrorBanner message={action.error} />}
      {action.message && <p role="status" className="text-[11px] text-success">{action.message}</p>}
      <p className="text-[11px] leading-relaxed text-text-faint">
        DeepDeck has its own runtime and data home. Your downloaded harness and the official Harness desktop app
        keep their own settings, sessions, plugins, and processes.
      </p>
    </div>
  );
}

function Row({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={`bg-card px-3 py-2.5 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-[10px] uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className={`mt-0.5 break-all text-xs text-text ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}
