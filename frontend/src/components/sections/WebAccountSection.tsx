import { Chrome, ExternalLink, FolderOpen, FolderPlus, Globe2, LogOut, Paperclip, RefreshCw, ShieldCheck } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge, unwrap } from "@/lib/bridge";
import { basename, relativeTime } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Badge, Button, ErrorBanner, SectionHeader } from "../ui";

export function WebAccountSection({ state, onRefresh }: { state: AppState; onRefresh: () => Promise<void> }) {
  const api = bridge();
  const action = useAction();
  const web = state.web;

  const run = (actionPromise: () => Promise<unknown>, message?: string) =>
    action.run(async () => {
      await actionPromise();
      await onRefresh();
    }, message);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="DeepSeek web chat"
        detail="Chat mode is the real chat.deepseek.com running in this window. It uses your web account and is independent of the harness API credentials."
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary"><Globe2 size={17} /></span>
            <div>
              <p className="text-sm font-medium text-text">{web.signedIn ? "Signed in" : "Not signed in"}</p>
              <p className="text-[11px] text-text-muted">
                {web.signedIn
                  ? `${web.method === "chrome" ? "Chrome import" : web.method === "google" ? "Google sign-in" : "Web session"} · ${relativeTime(web.signedInAt)} · ${web.cookieCount} cookie${web.cookieCount === 1 ? "" : "s"}`
                  : "Sign in to use the chat; the page still works in signed-out mode."}
              </p>
            </div>
          </div>
          <Badge tone={web.signedIn ? "success" : "muted"}>{web.signedIn ? "Connected" : "Signed out"}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!web.signedIn && (
            <>
              <Button variant="primary" size="sm" disabled={action.busy || !web.chromeAvailable} onClick={() => void run(() => unwrap(api.web.beginChromeSignIn()))}>
                <Chrome size={13} />Sign in with Google in Chrome
              </Button>
              <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void run(() => unwrap(api.web.signInInApp()))}>
                <Globe2 size={13} />Open sign-in page
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void run(() => api.web.reloadChat(), "Chat reloaded.")}>
            <RefreshCw size={13} />Reload chat
          </Button>
          {web.signedIn && (
            <Button variant="danger" size="sm" disabled={action.busy} onClick={() => void run(() => unwrap(api.web.signOut()), "Signed out of DeepSeek web.")}>
              <LogOut size={13} />Sign out
            </Button>
          )}
        </div>

        {web.detail && <p role="status" className="mt-3 text-[11px] text-text-muted">{web.detail}</p>}
        {action.error && <div className="mt-3"><ErrorBanner message={action.error} /></div>}
        {action.message && <p role="status" className="mt-3 text-[11px] text-success">{action.message}</p>}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Paperclip size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">Local file access for chat</p>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-text-muted">
                Set a folder as the starting point for chat attachments. The remote page cannot browse a local
                directory; it receives only the files you explicitly select in the paperclip picker. Setting a folder
                reads nothing and adds no files to the chat.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={action.busy || !web.signedIn}
              title={web.signedIn ? "Attach files from the chat folder to a message" : "Sign in to DeepSeek web chat first"}
              onClick={() => void run(() => api.web.attachFiles())}
            >
              <Paperclip size={13} />Attach files
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={action.busy}
              title="Choose the folder that the chat paperclip picker starts in"
              onClick={() => void run(() => unwrap(api.web.grantDirectory()), "Chat folder set.")}
            >
              <FolderPlus size={13} />Set chat folder
            </Button>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-text-faint">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          Chat cannot browse the rest of the filesystem, read your clipboard, use the camera or microphone, open
          notifications, or reach local services such as the harness. File selections are capped at 64 MB per file
          and 96 MB per selection. The folder grant only changes the picker's starting directory; the remote page
          still cannot read anything you have not selected.
        </p>
        {state.prefs.web.chatDirectory && (
          <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[10px] text-text-faint">
            <FolderOpen size={11} className="shrink-0" />
            <span className="truncate">Chat folder: <span className="mono text-text-muted">{basename(state.prefs.web.chatDirectory) || state.prefs.web.chatDirectory}</span></span>
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-xs font-medium text-text">Google sign-in runs in Chrome</p>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-text-muted">
          Google rejects embedded browsers with “This browser or app may not be secure.” DeepDeck opens a normal Chrome
          window with a temporary profile. Finish the real Google flow there; DeepDeck detects the signed-in DeepSeek tab,
          imports its cookies and chat storage into DeepDeck's persistent session, then deletes the temporary profile.
          Your normal Chrome profile is never opened or copied.
        </p>
        <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-text-faint">
          The web account has no API cost. It never changes the harness API key, the default model, or provider settings.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="flex items-center gap-2 text-xs font-medium text-text"><ExternalLink size={13} />Web sign-in is separate from the harness</p>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-text-muted">
          The harness uses <span className="mono">$DSH_HOME/.credentials.yaml</span> and environment references, not a
          Google account. Configure those under Providers. A DeepSeek web session cannot authenticate API requests, and an
          API key cannot sign in to the web chat.
        </p>
      </div>
    </div>
  );
}
