import * as React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Loader2, RotateCw } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge, errorMessage, unwrap } from "@/lib/bridge";
import { DeepSeekMark } from "./DeepSeekMark";
import { Button } from "./ui";

export function StartupPanel({
  state, onRefresh, onChat, onSettings,
}: {
  state: AppState;
  onRefresh: () => Promise<void>;
  onChat: () => void;
  onSettings: () => void;
}) {
  const api = bridge();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const harness = state.harness;
  const ready = harness.state === "ready";
  const preparing = harness.state === "preparing" || Boolean(state.updates?.busy);
  const progress = state.updates?.progress;
  const interfaceError = state.views?.code.state === "error" ? state.views.code.detail : null;
  React.useEffect(() => { if (preparing) setError(null); }, [preparing]);

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.harness.restart());
      await onRefresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-brand">
            <DeepSeekMark size={20} title="DeepSeek" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-text">Coding mode</h1>
            <p className="text-xs text-text-muted">DeepSeek Harness in {state.prefs.harness.workdir}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ol className="divide-y divide-border">
            <Step
              index={1}
              title="Workspace"
              detail={state.prefs.harness.workdir}
              status="done"
            />
            <Step
              index={2}
              title="Harness"
              detail={
                preparing ? (progress || "Preparing the private coding runtime…")
                  : harness.state === "starting" ? "Starting dsh web and opening its session…"
                  : harness.state === "ready" ? `Ready on 127.0.0.1:${harness.port ?? "?"}`
                    : harness.state === "error" ? "Failed to start"
                      : harness.state === "stopping" ? "Stopping…"
                        : "Stopped"
              }
              status={harness.state === "ready" ? "done" : (preparing || harness.state === "starting") ? "loading" : harness.state === "error" ? "error" : "idle"}
            />
            <Step
              index={3}
              title="Interface"
              detail={interfaceError || (ready ? "Loading the harness interface and plugins…" : "Waits for the harness")}
              status={interfaceError ? "error" : ready ? "loading" : "idle"}
            />
          </ol>
        </div>

        {!preparing && (harness.error || error || interfaceError) && (
          <div role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-danger">
              <AlertTriangle size={14} />{interfaceError ? "The coding interface did not load" : "Code setup needs attention"}
            </div>
            <pre className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-muted">
              {error || harness.error || interfaceError}
            </pre>
          </div>
        )}

        {preparing && <p role="status" className="mt-4 text-xs leading-relaxed text-text-muted">
          First setup downloads the coding runtime and its dependencies. This can take several minutes; progress appears above.
          Keep DeepDeck open until setup finishes. Chat remains available.
        </p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void restart()} disabled={busy || preparing || harness.state === "starting"}>
            {busy || preparing || harness.state === "starting" ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
            {preparing ? "Preparing Code…" : harness.state === "error" || harness.state === "stopped" ? "Start / retry Code" : "Restart harness"}
          </Button>
          <Button variant="outline" onClick={() => void api.harness.openLog()}>Open log</Button>
          <Button variant="ghost" onClick={onSettings}>Check settings</Button>
          <Button variant="ghost" onClick={onChat}>Use Chat instead <ArrowRight size={13} /></Button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-text-faint">
          DeepDeck uses a private harness runtime and data home. Existing settings and sessions are copied once;
          your downloaded harness and the official desktop app stay independent.
        </p>
      </div>
    </div>
  );
}

function Step({
  index, title, detail, status,
}: {
  index: number;
  title: string;
  detail: string;
  status: "done" | "loading" | "error" | "idle";
}) {
  const icon = status === "done" ? <CheckCircle2 size={15} className="text-success" />
    : status === "loading" ? <Loader2 size={15} className="animate-spin text-primary" />
      : status === "error" ? <AlertTriangle size={15} className="text-danger" />
        : <span className="grid h-[15px] w-[15px] place-items-center rounded-full border border-border text-[9px] text-text-faint">{index}</span>;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text">{title}</p>
        <p className="mono mt-0.5 break-all text-[11px] text-text-muted">{detail}</p>
      </div>
    </li>
  );
}

export function ChatEmptyPanel({ state }: { state: AppState }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-center">
      <div>
        <Loader2 size={18} className="mx-auto animate-spin text-primary" />
        <p className="mt-3 text-sm font-medium text-text">Opening DeepSeek chat</p>
        <p className="mt-1 text-xs text-text-muted">Loading the signed-in web session in this window.</p>
        {state.web.signedIn && <p className="mt-2 text-[11px] text-text-faint">Signed in · web account</p>}
      </div>
    </div>
  );
}

export function OpenLogButton({ path }: { path: string }) {
  const api = bridge();
  return (
    <Button variant="ghost" size="sm" onClick={() => void api.harness.openLog()} title={path}>
      <ExternalLink size={12} />Log
    </Button>
  );
}
