import { Code2, Globe2, ShieldCheck } from "lucide-react";
import { DeepSeekMark } from "./DeepSeekMark";
import { Button, Dialog } from "./ui";

export function WelcomeDialog({
  open, onClose, onSignIn, onCode,
}: {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onCode: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Welcome to DeepDeck"
      description="One window, two separate ways to work with DeepSeek."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Set up later</Button>
          <Button variant="outline" onClick={onCode}><Code2 size={13} />Open coding mode</Button>
          <Button variant="primary" onClick={onSignIn}><Globe2 size={13} />Sign in to web chat</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
          <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-md border border-border bg-background text-brand"><DeepSeekMark size={16} title="DeepSeek" /></span>
          <div>
            <p className="text-xs font-semibold text-text">Chat — the real DeepSeek web chat</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
              The signed-in chat.deepseek.com in this window, using your web account. Google sign-in opens a real Chrome
              window; DeepDeck then imports the session and verifies it here.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
          <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary"><Code2 size={16} /></span>
          <div>
            <p className="text-xs font-semibold text-text">Code — your DeepSeek Harness</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
              The dsh Web GUI with your existing sessions, default workspace, models, and subagents. DeepDeck starts a
              harness of its own; the one you already have open is untouched.
            </p>
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text-faint">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          The web account and the API setup are separate. Signing out of the web chat does not change your harness
          credentials.
        </p>
      </div>
    </Dialog>
  );
}
