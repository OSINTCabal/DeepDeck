import * as React from "react";
import { Moon, Settings as SettingsIcon, Sun, UserRound, X } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge, errorMessage, unwrap } from "@/lib/bridge";
import { relativeTime } from "@/lib/format";
import { isDarkTheme, themeOption } from "@/lib/theme";
import { Badge, Button, cn } from "./ui";

export function AccountPanel({
  state, onClose, onSettings, onRefresh,
}: {
  state: AppState;
  onClose: () => void;
  onSettings: () => void;
  onRefresh: () => Promise<void>;
}) {
  const api = bridge();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const web = state.web;
  const panel = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    panel.current?.focus();
  }, []);

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await onRefresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-black/20 p-3 dd-enter" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-border bg-popover shadow-xl outline-none dd-panel-in"
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-text-muted"><UserRound size={17} /></div>
          <div className="min-w-0 flex-1">
            <p id={titleId} className="text-sm font-semibold text-text">DeepSeek web account</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {web.signedIn ? `Signed in · ${web.method === "chrome" ? "Chrome import" : web.method === "google" ? "Google" : "web session"}` : "Not signed in"}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close account menu" onClick={onClose}><X size={14} /></Button>
        </div>

        <div className="space-y-3 px-4 py-3.5">
          <p className="text-xs leading-relaxed text-text-muted">
            Chat mode uses this web account, not API credits. Coding mode uses its separate API setup in DeepDeck’s private harness data home.
          </p>

          {web.signedIn ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <div>
                <p className="text-xs font-medium text-text">Session saved</p>
                <p className="text-[11px] text-text-faint">
                  {web.cookieCount} cookie{web.cookieCount === 1 ? "" : "s"} · signed in {relativeTime(web.signedInAt)}
                </p>
              </div>
              <Badge tone="success">Connected</Badge>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                variant="primary"
                className="w-full"
                disabled={Boolean(busy)}
                onClick={() => { onClose(); void run("chrome", () => unwrap(api.web.beginChromeSignIn())); }}
              >
                Sign in with Google in Chrome
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => { onClose(); void run("in-app", () => unwrap(api.web.signInInApp())); }}
                  title="Open the DeepSeek sign-in page for email or another in-page method"
                >
                  DeepSeek sign-in page
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => { onClose(); void api.web.reloadChat(); }}
                >
                  Reload chat
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-text-faint">
                Google refuses embedded browsers, so Google sign-in runs in a normal Chrome window. DeepDeck then imports
                the DeepSeek session and verifies it inside the app. The DeepSeek page button is for the site's email
                sign-in; choosing Google there switches to Chrome automatically.
              </p>
            </div>
          )}

          {web.signedIn && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void run("reload", () => api.web.reloadChat())}>Reload chat</Button>
              <Button
                variant="danger"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => void run("sign-out", () => unwrap(api.web.signOut()))}
              >
                Sign out
              </Button>
            </div>
          )}

          {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
          {web.detail && !error && <p className="break-words text-xs text-text-muted">{web.detail}</p>}
          {!web.chromeAvailable && (
            <p className="text-[11px] text-text-faint">Google sign-in unavailable: install Google Chrome or Chromium.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-text-faint">
            {isDarkTheme(state.prefs.theme) ? <Moon size={11} /> : <Sun size={11} />}
            <span className="truncate">{themeOption(state.prefs.theme).label} theme</span>
          </span>
          <Button variant="ghost" size="sm" onClick={onSettings}><SettingsIcon size={12} />Settings</Button>
        </div>
      </div>
    </div>
  );
}

export function AccountButtonBadge({ signedIn }: { signedIn: boolean }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", signedIn ? "bg-success" : "bg-text-faint/50")} />;
}
