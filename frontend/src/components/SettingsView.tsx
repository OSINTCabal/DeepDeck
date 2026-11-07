import * as React from "react";
import {
  Activity, ChevronRight, CircleHelp, Code2, Cpu, Download, Globe2, Info, Settings2, Sparkles, X,
} from "lucide-react";
import type { AppState, Mode } from "@/lib/bridge";
import { DeepSeekMark } from "./DeepSeekMark";
import { Button, cn } from "./ui";
import { GeneralSection } from "./sections/GeneralSection";
import { WebAccountSection } from "./sections/WebAccountSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { SubagentsSection } from "./sections/SubagentsSection";
import { HarnessSection } from "./sections/HarnessSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { UsageSection } from "./sections/UsageSection";
import { AboutSection } from "./sections/AboutSection";

export type SettingsSection = "general" | "account" | "providers" | "subagents" | "harness" | "usage" | "updates" | "about";

const ITEMS: Array<{ id: SettingsSection; label: string; icon: React.ReactNode; hint: string }> = [
  { id: "general", label: "General", icon: <Settings2 size={14} />, hint: "Appearance and workspace" },
  { id: "account", label: "Web account", icon: <Globe2 size={14} />, hint: "DeepSeek chat sign-in" },
  { id: "providers", label: "Providers", icon: <Sparkles size={14} />, hint: "Models, keys, default route" },
  { id: "subagents", label: "Subagents", icon: <Cpu size={14} />, hint: "Delegation backends" },
  { id: "harness", label: "Harness", icon: <Code2 size={14} />, hint: "Process, log, paths" },
  { id: "usage", label: "API usage", icon: <Activity size={14} />, hint: "DeepSeek platform dashboard" },
  { id: "updates", label: "Updates", icon: <Download size={14} />, hint: "Private runtime and app" },
  { id: "about", label: "About", icon: <Info size={14} />, hint: "Version and notices" },
];

export function SettingsView({
  state, section, onSection, onClose, onRefresh, onMode,
}: {
  state: AppState;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onMode: (mode: Mode) => void;
}) {
  const active = ITEMS.find(item => item.id === section) || ITEMS[0];
  const updateAvailable = Boolean(state.updates?.harness?.pendingVersion);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    root.current?.focus();
  }, []);
  return (
    <div
      ref={root}
      role="region"
      aria-label="Settings"
      tabIndex={-1}
      className="dd-enter flex h-full min-h-0 bg-background outline-none"
    >
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/60">
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <DeepSeekMark size={17} className="shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text">Settings</p>
              <p className="truncate text-[10px] text-text-faint">DeepDeck control plane</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close settings" title="Close settings" onClick={onClose}>
            <X size={15} />
          </Button>
        </div>
        <nav aria-label="Settings sections" className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {ITEMS.map(item => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => onSection(item.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                section === item.id ? "bg-muted text-text" : "text-text-muted hover:bg-muted/60 hover:text-text",
              )}
            >
              <span className={cn("mt-0.5", section === item.id ? "text-primary" : "text-text-faint")}>{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {item.label}
                  {item.id === "updates" && updateAvailable && (
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Harness update available" aria-label="Harness update available" />
                  )}
                </span>
                <span className="block text-[10px] text-text-faint">{item.hint}</span>
              </span>
              {section === item.id && <ChevronRight size={12} className="mt-0.5 text-text-faint" />}
            </button>
          ))}
        </nav>
        <div className="border-t border-border px-3 py-2.5">
          <p className="text-[10px] leading-relaxed text-text-faint">
            Web chat and Code keep separate accounts. Changing one never changes the other.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={() => void window.deepdeck?.openExternal("https://www.deepseek.com/")}>
            <CircleHelp size={12} />DeepSeek
          </Button>
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-text">{active.label}</h1>
              <p className="mt-0.5 text-xs text-text-muted">{active.hint}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onMode(state.mode)}>Back to {state.mode === "chat" ? "Chat" : "Code"}</Button>
              <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
            </div>
          </header>

          <div key={section} className={section === "usage" ? undefined : "dd-rise"}>
            {section === "general" && <GeneralSection state={state} onRefresh={onRefresh} />}
            {section === "account" && <WebAccountSection state={state} onRefresh={onRefresh} />}
            {section === "providers" && <ProvidersSection />}
            {section === "subagents" && <SubagentsSection />}
            {section === "harness" && <HarnessSection state={state} onRefresh={onRefresh} />}
            {section === "usage" && <UsageSection />}
            {section === "updates" && <UpdatesSection state={state} onRefresh={onRefresh} />}
            {section === "about" && <AboutSection state={state} />}
          </div>
        </div>
      </section>
    </div>
  );
}
