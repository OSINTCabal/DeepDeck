import * as React from "react";
import { createPortal } from "react-dom";
import {
  Activity, Check, Code2, Copy, Cpu, Download, ExternalLink, FileText, FolderOpen, FolderPlus, Globe2, Info,
  MessageCircle, Paperclip, RotateCw, Search, Settings, Settings2, Sparkles,
  UserRound, Zap,
} from "lucide-react";
import type { AppState, Mode } from "@/lib/bridge";
import { bridge, errorMessage, unwrap } from "@/lib/bridge";
import type { SettingsSection } from "./SettingsView";
import { Kbd, cn } from "./ui";

interface PaletteAction {
  id: string;
  group: string;
  label: string;
  keywords?: string;
  shortcut?: string;
  /** Keep the palette open and show this confirmation after a successful run. */
  done?: string;
  icon: React.ReactNode;
  run: () => void | Promise<unknown>;
}

export function CommandPalette({
  open, onClose, state, onMode, onSettings, onRefresh, onAccount, onRevealWorkspace,
}: {
  open: boolean;
  onClose: () => void;
  state: AppState;
  onMode: (mode: Mode) => void;
  onSettings: (section: SettingsSection) => void;
  onRefresh: () => Promise<void>;
  onAccount: () => void;
  onRevealWorkspace: () => void;
}) {
  const api = bridge();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const previous = React.useRef<HTMLElement | null>(null);

  const actions = React.useMemo<PaletteAction[]>(() => {
    const settings = (section: SettingsSection, label: string, icon: React.ReactNode, keywords = ""): PaletteAction => ({
      id: `settings-${section}`,
      group: "Settings",
      label,
      keywords: `settings preferences ${section} ${keywords}`,
      icon,
      run: () => onSettings(section),
    });
    return [
      { id: "mode-chat", group: "Go to", label: "Switch to Chat", keywords: "deepseek web chat conversation", shortcut: "Ctrl 1", icon: <MessageCircle size={15} />, run: () => onMode("chat") },
      { id: "mode-code", group: "Go to", label: "Switch to Code", keywords: "harness coding agent", shortcut: "Ctrl 2", icon: <Code2 size={15} />, run: () => onMode("code") },
      { id: "reload", group: "View", label: "Reload current page", keywords: "refresh retry", shortcut: "Ctrl R", icon: <RotateCw size={15} />, run: async () => { await unwrap(api.harness.reload()); } },
      {
        id: "focus",
        group: "View",
        label: state.focusMode ? "Exit focus mode" : "Enter focus mode",
        keywords: "hide app bar immersive",
        shortcut: "Ctrl Shift F",
        icon: <Zap size={15} />,
        run: async () => { await api.setFocus(!state.focusMode); },
      },
      { id: "workspace-open", group: "Workspace", label: "Open workspace folder", keywords: "files folder reveal", icon: <FolderOpen size={15} />, run: async () => { await api.workspace.openFolder(); } },
      { id: "documents-open", group: "Workspace", label: "Open Documents folder", keywords: "home files directory", icon: <FolderOpen size={15} />, run: async () => { await api.workspace.openDocuments(); } },
      {
    id: "workspace-copy",
    group: "Workspace",
    label: "Copy workspace path",
    keywords: "clipboard folder",
    icon: <Copy size={15} />,
    done: "Path copied",
    run: async () => { await api.workspace.copyPath(); },
  },
      { id: "workspace-code", group: "Workspace", label: "Show workspace in coding mode", keywords: "harness session", icon: <Code2 size={15} />, run: () => onRevealWorkspace() },
      {
        id: "attach-chat",
        group: "Workspace",
        label: "Attach files to DeepSeek chat",
        keywords: "upload analyze code local context source",
        icon: <Paperclip size={15} />,
        run: async () => { await api.web.attachFiles(); },
      },
      {
        id: "chat-folder",
        group: "Workspace",
        label: "Set chat folder…",
        keywords: "directory local access attachments project documents",
        icon: <FolderPlus size={15} />,
        run: async () => { await unwrap(api.web.grantDirectory()); },
      },
      {
        id: "workspace-change",
        group: "Workspace",
        label: "Change workspace…",
        keywords: "folder directory set",
        icon: <Settings2 size={15} />,
        run: () => onSettings("general"),
      },
      {
        id: "harness-restart",
        group: "Harness",
        label: state.harness.state === "ready" ? "Restart harness" : "Start harness",
        keywords: "dsh server process",
        icon: <RotateCw size={15} />,
        run: async () => { await unwrap(api.harness.restart()); await onRefresh(); },
      },
      { id: "harness-log", group: "Harness", label: "Open harness log", keywords: "debug output", icon: <FileText size={15} />, run: async () => { await api.harness.openLog(); } },
      { id: "harness-data", group: "Harness", label: "Open DeepDeck data folder", keywords: "config logs directory", icon: <FolderOpen size={15} />, run: async () => { await api.harness.openConfigFolder(); } },
      { id: "harness-plugins", group: "Harness", label: "Open harness plugins", keywords: "extensions settings", icon: <ExternalLink size={15} />, run: async () => { await unwrap(api.harness.openSettings("plugins")); } },
      { id: "account", group: "Web account", label: "DeepSeek web account", keywords: "sign in google chrome session", icon: <UserRound size={15} />, run: () => onAccount() },
      { id: "account-reload", group: "Web account", label: "Reload DeepSeek chat", keywords: "refresh web", icon: <RotateCw size={15} />, run: async () => { await api.web.reloadChat(); } },
      settings("general", "General settings", <Settings size={15} />, "appearance workspace port patch"),
      settings("account", "Web account settings", <Globe2 size={15} />, "sign-in chrome google"),
      settings("providers", "Providers and models", <Sparkles size={15} />, "api keys routes default model"),
      settings("subagents", "Subagents", <Cpu size={15} />, "codex claude delegation"),
      settings("harness", "Harness settings", <Code2 size={15} />, "process port log private runtime"),
      settings("usage", "API usage", <Activity size={15} />, "platform tokens billing balance"),
      settings("updates", "Updates", <Download size={15} />, "harness release app version upgrade"),
      settings("about", "About DeepDeck", <Info size={15} />, "version license paths"),
    ];
  }, [api, onAccount, onMode, onRefresh, onRevealWorkspace, onSettings, state.focusMode, state.harness.state]);

  const results = React.useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return actions;
    return actions.filter(action => {
      const haystack = `${action.label} ${action.group} ${action.keywords || ""}`.toLowerCase();
      return words.every(word => haystack.includes(word));
    });
  }, [actions, query]);

  React.useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setError(null);
    setNotice(null);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    setActive(current => (results.length === 0 ? 0 : Math.min(current, results.length - 1)));
  }, [results.length]);

  React.useEffect(() => {
    if (!open) return;
    const selected = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
  }, [active, open, results]);

  React.useEffect(() => {
    if (open) return;
    previous.current?.focus?.();
    previous.current = null;
  }, [open]);

  const close = React.useCallback(() => {
    if (busy) return;
    setNotice(null);
    onClose();
  }, [busy, onClose]);

  const runAction = async (action: PaletteAction | undefined) => {
    if (!action || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action.run();
      if (action.done) {
        setNotice(action.done);
        setBusy(false);
        input.current?.focus();
        return;
      }
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      setActive(current => {
        const offset = event.key === "ArrowDown" ? 1 : -1;
        return (current + offset + results.length) % results.length;
      });
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : Math.max(0, results.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void runAction(results[active]);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      input.current?.focus();
    }
  };

  if (!open) return null;
  const activeId = results[active] ? `palette-option-${results[active].id}` : undefined;
  let lastGroup = "";
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-4 pt-[10vh] dd-enter"
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl dd-rise"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-3.5">
          <Search size={16} className="shrink-0 text-text-faint" />
          <h2 id={titleId} className="sr-only">Quick actions</h2>
          <input
            ref={input}
            value={query}
            onChange={event => { setQuery(event.target.value); setActive(0); }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search quick actions"
            placeholder="Search actions, settings, and workspace…"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={list} id="palette-list" role="listbox" aria-label="Quick actions" className="max-h-[min(62vh,30rem)] overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-xs font-medium text-text">No matching actions</p>
              <p className="mt-1 text-[11px] text-text-muted">Try “chat”, “workspace”, “harness”, or “theme”.</p>
            </div>
          )}
          {results.map((action, index) => {
            const heading = action.group !== lastGroup ? action.group : null;
            lastGroup = action.group;
            return (
              <React.Fragment key={action.id}>
                {heading && (
                  <p role="presentation" className="px-2 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-text-faint first:pt-1">
                    {heading}
                  </p>
                )}
                <div
                  id={`palette-option-${action.id}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => { if (index !== active) setActive(index); }}
                  onClick={() => void runAction(action)}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-xs transition-colors",
                    index === active ? "bg-muted text-text" : "text-text-muted",
                  )}
                >
                  <span className={cn("shrink-0", index === active ? "text-primary" : "text-text-faint")}>{action.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.shortcut && <span className="shrink-0 text-[10px] text-text-faint">{action.shortcut}</span>}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="border-t border-danger/20 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-3 text-[10px] text-text-faint">
            <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> run</span>
          </div>
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[10px]" role="status">
            {busy
              ? <><span className="dd-spinner !h-3 !w-3" aria-hidden="true" /><span className="text-text-faint">Working…</span></>
              : notice
                ? <><Check size={11} className="text-success" />{notice}</>
                : <span className="text-text-faint">DeepDeck quick actions</span>}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
