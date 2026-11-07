import { ExternalLink } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge } from "@/lib/bridge";
import { shortPath } from "@/lib/format";
import { DeepSeekMark } from "../DeepSeekMark";
import { Button, cn } from "../ui";

export function AboutSection({ state }: { state: AppState }) {
  const api = bridge();
  const open = (url: string) => void api.openExternal(url);
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-brand">
          <DeepSeekMark size={24} title="DeepSeek" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">DeepDeck</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
            A Fedora desktop shell for DeepSeek's web chat and the DeepSeek Harness. Unofficial; not affiliated with or
            endorsed by DeepSeek.
          </p>
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Row label="DeepDeck" value={state.version} />
        <Row label="Electron" value={state.versions.electron} />
        <Row label="Chromium" value={state.versions.chrome} />
        <Row label="Node" value={state.versions.node} />
        <Row label="Config" value={shortPath(state.paths.configFile, 64)} mono wide />
        <Row label="Data" value={shortPath(state.paths.dataDir, 64)} mono wide />
        <Row label="Harness log" value={shortPath(state.paths.harnessLog, 64)} mono wide />
        <Row label="Shell origin" value={state.shellOrigin || "dev"} mono wide />
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="text-xs font-medium text-text">What is embedded</p>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-text-muted">
          Chat is the real <span className="mono">chat.deepseek.com</span> loaded top-level in its own persistent session.
          Code is the real dsh Web GUI loaded at its authenticated loopback URL. DeepDeck does not reimplement either
          interface, scrape conversations, or upload local sessions. Provider and subagent controls use the harness's own
          authenticated host API.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => open("https://chat.deepseek.com/")}><ExternalLink size={13} />DeepSeek chat</Button>
        <Button variant="outline" size="sm" onClick={() => open("https://api-docs.deepseek.com/")}><ExternalLink size={13} />API docs</Button>
        <Button variant="outline" size="sm" onClick={() => open("https://deepseek-harness.github.io/deepseek-harness/")}><ExternalLink size={13} />Harness docs</Button>
        <Button variant="ghost" size="sm" onClick={() => open("https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html")}><ExternalLink size={13} />DeepSeek terms</Button>
      </div>

      <p className="max-w-2xl text-[11px] leading-relaxed text-text-faint">
        DeepSeek, DeepSeek Harness, and related marks belong to DeepSeek. The DeepSeek web-chat mark is used only to
        identify the embedded DeepSeek pages; this is not an official DeepSeek product. The web chat is used through the user's own browser session; the harness runs from DeepDeck’s
        private released installation.
      </p>
    </div>
  );
}

function Row({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn("bg-card px-3 py-2.5", wide && "sm:col-span-2")}>
      <dt className="text-[10px] uppercase tracking-wide text-text-faint">{label}</dt>
      <dd title={value} className={`mt-0.5 break-words text-xs text-text ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}
