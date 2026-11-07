import * as React from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { bridge, errorMessage } from "@/lib/bridge";
import { DEEPSEEK_USAGE_URL } from "@/lib/links";
import { Button, ErrorBanner } from "../ui";

export function UsageSection() {
  const api = bridge();
  const host = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloading, setReloading] = React.useState(false);

  const reportBounds = React.useCallback(() => {
    const element = host.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void api.usage.show({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      .catch(cause => setError(errorMessage(cause)));
  }, [api]);

  React.useLayoutEffect(() => {
    const frame = requestAnimationFrame(reportBounds);
    const observer = new ResizeObserver(reportBounds);
    if (host.current) observer.observe(host.current);
    window.addEventListener("resize", reportBounds);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", reportBounds);
      void api.usage.hide();
    };
  }, [api, reportBounds]);

  const reload = () => {
    setError(null);
    setReloading(true);
    void api.usage.reload()
      .then(reportBounds)
      .catch(cause => setError(errorMessage(cause)))
      .finally(() => setReloading(false));
  };

  const openExternal = () => {
    setError(null);
    void api.openExternal(DEEPSEEK_USAGE_URL).catch(cause => setError(errorMessage(cause)));
  };

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[320px] flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-[11px] leading-relaxed text-text-muted">
          Live DeepSeek Platform dashboard. Sign in below with the DeepSeek API account that owns the key; this uses a
          separate persistent platform session, not the web chat account.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={reload} disabled={reloading}>
            {reloading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}Reload
          </Button>
          <Button variant="ghost" size="sm" onClick={openExternal}>
            <ExternalLink size={13} />Open in browser
          </Button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <div
        ref={host}
        aria-label="DeepSeek API usage dashboard"
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <Loader2 size={17} className="mx-auto animate-spin text-primary" />
            <p className="mt-2 text-xs font-medium text-text">Opening DeepSeek Platform</p>
            <p className="mt-1 text-[11px] text-text-faint">Tokens, balances, and billing load here.</p>
          </div>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-text-faint">
        <ShieldCheck size={11} className="mt-0.5 shrink-0" />
        The dashboard is isolated from chat and harness credentials. Only platform.deepseek.com navigation is allowed
        inside this view; other links open in your browser.
      </p>
    </div>
  );
}
