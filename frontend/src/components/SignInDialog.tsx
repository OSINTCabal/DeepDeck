import * as React from "react";
import { Chrome, ExternalLink, Loader2, Monitor, ShieldCheck } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge, errorMessage, unwrap } from "@/lib/bridge";
import { Button, Dialog, ErrorBanner } from "./ui";

export function SignInDialog({
  state, onRefresh,
}: {
  state: AppState;
  onRefresh: () => Promise<void>;
}) {
  const api = bridge();
  const web = state.web;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const open = web.phase !== "idle";

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onRefresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const isError = web.phase === "error";
  const isWaitingChrome = web.phase === "waiting-chrome";
  const isImporting = web.phase === "importing";

  const footer = isImporting ? null : isError ? (
    <>
      <Button variant="ghost" onClick={() => void run(() => unwrap(api.web.cancelSignIn()))}>Close</Button>
      <Button variant="outline" onClick={() => void run(() => unwrap(api.web.signInInApp()))}>Try in-app</Button>
      <Button variant="primary" onClick={() => void run(() => unwrap(api.web.beginChromeSignIn()))} disabled={!web.chromeAvailable}>
        <Chrome size={13} />Use Chrome
      </Button>
    </>
  ) : isWaitingChrome ? (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => void run(() => unwrap(api.web.cancelSignIn()))}>Cancel</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(() => unwrap(api.web.focusChrome()))}>
        <Monitor size={13} />Show Chrome
      </Button>
      <Button variant="primary" disabled={busy} onClick={() => void run(() => unwrap(api.web.confirmChromeSignIn(true)))}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
        I have signed in
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => void run(() => unwrap(api.web.cancelSignIn()))}>Cancel</Button>
      <Button variant="outline" disabled={busy || !web.chromeAvailable} onClick={() => void run(() => unwrap(api.web.beginChromeSignIn()))}>
        <Chrome size={13} />Use Chrome instead
      </Button>
    </>
  );

  return (
    <Dialog
      open
      closable={!isImporting}
      onClose={() => {
        // The import is reading Chrome's profile; closing now would cancel it
        // halfway. Let the state machine finish and report the result.
        if (isImporting) return;
        void unwrap(api.web.cancelSignIn()).catch(() => {});
      }}
      title={isError ? "Sign-in did not complete" : isWaitingChrome ? "Sign in with Google in Chrome" : isImporting ? "Bringing your session into DeepDeck" : "Sign in to DeepSeek web"}
      description={
        isError ? "The session was not changed. You can retry or use the DeepSeek page's email sign-in."
          : isWaitingChrome ? "A real Chrome window is open. Google works there because it is a real browser. Leave Chrome open until the DeepSeek chat appears."
            : isImporting ? "Reading the live DeepSeek session from Chrome and checking it inside DeepDeck."
              : "This window is for the site's email sign-in. Choosing Google hands off to Chrome automatically."
      }
      size="md"
      footer={footer}
    >
      <div className="space-y-3.5">
        {isImporting && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin text-primary" />{web.detail || "Importing and verifying the session…"}
          </div>
        )}
        {isWaitingChrome && (
          <div className="flex items-start gap-2 rounded-md border border-info/25 bg-info/5 px-3 py-2 text-xs text-info">
            <Monitor size={14} className="mt-0.5 shrink-0" />
            <span>A Chrome window is open for DeepSeek. Leave it open; DeepDeck will import the session automatically when the chat appears. If you cannot find the window, choose <span className="font-medium">Show Chrome</span>.</span>
          </div>
        )}
        {isWaitingChrome && (
          <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-text-muted">
            <li>In Chrome, choose <span className="font-medium text-text">Google</span> and finish signing in.</li>
            <li>Wait until you reach the <span className="font-medium text-text">DeepSeek chat</span>, not the sign-in page.</li>
            <li>Return here. DeepDeck detects the session automatically; you can also choose <span className="font-medium text-text">I have signed in</span>.</li>
          </ol>
        )}
        {web.phase === "in-app" && (
          <p className="text-xs leading-relaxed text-text-muted">
            Use the email form here, or choose Google. Google refuses embedded browsers, so DeepDeck switches to a
            normal Chrome window automatically and continues there.
          </p>
        )}
        {error && <ErrorBanner message={error} />}
        {!error && !isImporting && web.detail && (
          <p
            role="status"
            aria-live="polite"
            className={
              isError
                ? "rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger"
                : isWaitingChrome
                  ? "rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-warning"
                  : "rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-text-muted"
            }
          >
            {web.detail}
          </p>
        )}
        {!web.chromeAvailable && (
          <p className="flex items-center gap-1.5 text-xs text-text-faint">
            <ExternalLink size={12} />Install Google Chrome or Chromium to sign in with Google.
          </p>
        )}
      </div>
    </Dialog>
  );
}
