import * as React from "react";
import {
  Code2, Copy, Download, FolderOpen, MessageCircle, Minus, Search, Settings,
  Square, UserRound, X,
} from "lucide-react";
import type { HarnessStatus, Mode, WebStatus } from "@/lib/bridge";
import { bridge } from "@/lib/bridge";
import { basename } from "@/lib/format";
import type { SettingsSection } from "./SettingsView";
import { Button, cn } from "./ui";

type WindowState = { maximized: boolean; minimized: boolean; fullscreen: boolean };

function useWindowState() {
  const [state, setState] = React.useState<WindowState>({ maximized: false, minimized: false, fullscreen: false });
  React.useEffect(() => {
    const api = window.deepdeck;
    if (!api) return;
    let disposed = false;
    void api.window.getState().then(value => { if (!disposed) setState(value); }).catch(() => {});
    const off = api.window.onState(value => setState(value));
    return () => { disposed = true; off(); };
  }, []);
  return state;
}

function statusTone(status: HarnessStatus) {
  switch (status.state) {
    case "ready": return "bg-success";
    case "preparing":
    case "starting": return "bg-warning animate-pulse";
    case "stopping": return "bg-warning";
    case "error": return "bg-danger";
    default: return "bg-text-faint/50";
  }
}

function statusLabel(status: HarnessStatus) {
  switch (status.state) {
    case "ready": return "Ready";
    case "preparing": return "Preparing Code";
    case "starting": return "Starting";
    case "stopping": return "Stopping";
    case "error": return "Error";
    default: return "Stopped";
  }
}

export function TopBar({
  mode, onMode, settingsOpen, onSettings, onOpenSettings, onPalette, onAccount,
  web, harness, workspace, updateAvailable,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  settingsOpen: boolean;
  onSettings: () => void;
  onOpenSettings: (section: SettingsSection) => void;
  onPalette: () => void;
  onAccount: () => void;
  web: WebStatus;
  harness: HarnessStatus;
  workspace: string;
  updateAvailable: boolean;
}) {
  const state = useWindowState();
  const api = bridge();
  const workspaceName = basename(workspace) || "Workspace";
  const ctrl = "h-10 w-10 grid place-items-center text-text-muted transition-colors hover:bg-muted hover:text-text no-drag";

  const openWorkspace = async () => {
    try {
      await api.workspace.openFolder();
    } catch {
      // The path may have moved since it was saved. Send the user to the
      // place where it can be corrected rather than failing silently.
      onOpenSettings("general");
    }
  };

  const tab = (value: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value && !settingsOpen}
      onClick={() => onMode(value)}
      className={cn(
        "no-drag relative inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
        mode === value && !settingsOpen ? "bg-muted text-text" : "text-text-muted hover:bg-muted/60 hover:text-text",
      )}
    >
      {icon}{label}
    </button>
  );

  return (
    <header
      className="drag-region flex h-10 shrink-0 select-none items-center border-b border-bar-border bg-bar pl-3"
      onDoubleClick={event => {
        if ((event.target as HTMLElement).closest(".no-drag")) return;
        if (window.deepdeck?.platform === "linux") void api.window.toggleMaximize();
      }}
    >
      <div className="flex items-center">
        <span className="text-xs font-semibold tracking-tight text-text">DeepDeck</span>
      </div>
      <span className="mx-2.5 h-4 w-px shrink-0 bg-border/80" aria-hidden="true" />
      <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-background/60 p-0.5 no-drag" role="tablist" aria-label="Mode">
        {tab("chat", "Chat", <MessageCircle size={12.5} />)}
        {tab("code", "Code", <Code2 size={12.5} />)}
      </div>

      <button
        type="button"
        onClick={() => void openWorkspace()}
        aria-label={`Open workspace folder: ${workspace}`}
        title={`${workspace}\nClick to open the folder. Chat attachments and coding sessions use it. Ctrl+K has copy path and more workspace actions.`}
        className="ml-3 inline-flex h-7 max-w-[15rem] shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-[11px] text-text-muted transition-colors no-drag hover:border-border/70 hover:bg-muted/60 hover:text-text"
      >
        <FolderOpen size={12.5} className="shrink-0 text-text-faint" />
        <span className="truncate font-medium">{workspaceName}</span>
      </button>

      <div className="h-full flex-1" />

      <div className="flex items-center no-drag">
        {updateAvailable && (
          <button
            type="button"
            onClick={() => onOpenSettings("updates")}
            aria-label="Harness update available — open Updates"
            title="Harness update available — open Settings → Updates"
            className="mr-1.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 text-[11px] font-medium text-warning transition-colors hover:bg-warning/15"
          >
            <Download size={12.5} />
            Update
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenSettings("harness")}
          title={`Harness ${harness.state}${harness.port ? ` on 127.0.0.1:${harness.port}` : ""} — open harness settings`}
          aria-label={`Harness ${statusLabel(harness)}. Open harness settings.`}
          className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-muted transition-colors hover:bg-muted hover:text-text"
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", statusTone(harness))} aria-hidden="true" />
          <span className="hidden sm:inline">{statusLabel(harness)}</span>
        </button>
        <button
          type="button"
          onClick={onPalette}
          aria-label="Quick actions"
          title="Quick actions (Ctrl+K)"
          className="grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-muted hover:text-text"
        >
          <Search size={15} />
        </button>
        <button
          type="button"
          onClick={onAccount}
          aria-label="DeepSeek web account"
          title={web.signedIn ? "DeepSeek web account" : "Sign in to DeepSeek web"}
          className="relative mr-1 grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-muted hover:text-text"
        >
          <UserRound size={15} />
          <span
            className={cn(
              "absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ring-2 ring-bar",
              web.signedIn ? "bg-success" : "bg-text-faint/50",
            )}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label={settingsOpen ? "Close settings" : "Open settings"}
          title="Settings (Ctrl+,)"
          className={cn(
            "grid h-8 w-8 place-items-center rounded-md transition-colors",
            settingsOpen ? "bg-muted text-text" : "text-text-muted hover:bg-muted hover:text-text",
          )}
        >
          <Settings size={15} />
        </button>
        <div className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />
        <Button variant="ghost" size="icon" className={ctrl} aria-label="Minimize" title="Minimize" onClick={() => void api.window.minimize()}>
          <Minus size={15} />
        </Button>
        <Button variant="ghost" size="icon" className={ctrl} aria-label={state.maximized ? "Restore" : "Maximize"} title={state.maximized ? "Restore" : "Maximize"} onClick={() => void api.window.toggleMaximize()}>
          {state.maximized ? <Copy size={13} /> : <Square size={12.5} />}
        </Button>
        <Button variant="ghost" size="icon" className={cn(ctrl, "hover:bg-danger hover:text-white")} aria-label="Close DeepDeck" title="Close" onClick={() => void api.window.close()}>
          <X size={15} />
        </Button>
      </div>
    </header>
  );
}
