import * as React from "react";
import { FolderOpen, RotateCcw, Zap } from "lucide-react";
import type { AppState } from "@/lib/bridge";
import { bridge } from "@/lib/bridge";
import { useAction } from "@/lib/useAction";
import { Button, ErrorBanner, Field, Input, Kbd, SectionHeader, Select } from "../ui";
import { ThemePicker } from "../ThemePicker";

const ZOOM_OPTIONS = [0.75, 0.9, 1, 1.1, 1.25, 1.5];

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "1"], label: "Chat" },
  { keys: ["Ctrl", "2"], label: "Code" },
  { keys: ["Ctrl", "K"], label: "Quick actions" },
  { keys: ["Ctrl", ","], label: "Settings" },
  { keys: ["Ctrl", "R"], label: "Reload page" },
  { keys: ["Ctrl", "Shift", "F"], label: "Focus mode" },
  { keys: ["F11"], label: "Full screen" },
  { keys: ["Ctrl", "Shift", "I"], label: "DevTools" },
  { keys: ["Ctrl", "+", "−", "0"], label: "Zoom" },
  { keys: ["Esc"], label: "Close overlay" },
];

export function GeneralSection({ state, onRefresh }: { state: AppState; onRefresh: () => Promise<void> }) {
  const api = bridge();
  const action = useAction();
  const [workdir, setWorkdir] = React.useState(state.prefs.harness.workdir);
  const [port, setPort] = React.useState(String(state.prefs.harness.port));

  React.useEffect(() => {
    setWorkdir(state.prefs.harness.workdir);
    setPort(String(state.prefs.harness.port));
  }, [state.prefs.harness.workdir, state.prefs.harness.port]);

  const save = async (patchObject: Record<string, unknown>, message: string) => {
    const done = await action.run(async () => {
      await api.savePreferences(patchObject);
      await onRefresh();
    }, message);
    return done;
  };

  const browse = async (kind: "workspace") => {
    const selected = await api.pickDirectory(kind);
    if (!selected) return;
    setWorkdir(selected);
  };

  const openWorkspace = () => void action.run(async () => {
    await api.workspace.openFolder();
  }, "Opened the workspace folder.");

  const applyHarnessPath = async () => {
    if (!workdir.trim()) return;
    await save({ harness: { workdir: workdir.trim() } }, "Workspace saved. DeepDeck’s private harness restarts in the new location.");
  };

  const applyPort = async () => {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      action.setError("Port must be an integer between 1024 and 65535.");
      return;
    }
    await save({ harness: { port: value } }, "Harness port saved. The harness restarts on the new port.");
  };

  return (
    <div className="space-y-7">
      <section className="space-y-3">
        <SectionHeader title="Appearance" detail="Applies to the app bar, the DeepSeek chat page, and the harness page together." />
        <Field
          label="Theme"
          hint="System follows the desktop. Themes restyle the shell; the embedded chat and harness pages follow their nearest light/dark mode."
        >
          <ThemePicker
            value={state.prefs.theme}
            disabled={action.busy}
            onChange={theme => void action.run(async () => {
              await api.setTheme(theme);
              await onRefresh();
            }, "Theme saved for the app and both pages.")}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="App zoom" hint="Scales the shell and both embedded pages.">
            <Select
              value={String(state.prefs.zoom)}
              disabled={action.busy}
              options={ZOOM_OPTIONS.map(value => ({ value: String(value), label: `${Math.round(value * 100)}%` }))}
              onChange={event => void action.run(async () => {
                await api.zoom.set(Number(event.target.value));
                await onRefresh();
              }, "Zoom saved.")}
            />
          </Field>
          <Field label="Mode on launch">
            <Select
              value={state.prefs.mode}
              disabled={action.busy}
              options={[{ value: "chat", label: "Chat" }, { value: "code", label: "Code" }]}
              onChange={event => void save({ mode: event.target.value }, "Launch mode saved.")}
            />
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              disabled={action.busy}
              onClick={() => void action.run(async () => {
                await api.setSettings(false);
                await api.setFocus(true);
              }, "Focus mode hides the app bar; press Ctrl+Shift+F or Esc to exit.")}
            >
              <Zap size={13} />Enter focus mode
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Workspace and harness"
          detail="The harness starts with this directory as its working directory, so new sessions and permission roots default here."
        />
        <Field label="Default workspace" hint="DeepDeck starts the harness in this folder. Chat attachments open here too. Changing it restarts the managed harness.">
          <div className="flex gap-2">
            <Input value={workdir} onChange={event => setWorkdir(event.target.value)} className="mono" aria-label="Default workspace path" />
            <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void openWorkspace()} title="Open the workspace in the file manager">
              <FolderOpen size={13} />Open
            </Button>
            <Button variant="outline" size="sm" onClick={() => void browse("workspace")} title="Choose a different workspace">
              Browse
            </Button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={action.busy} onClick={() => void applyHarnessPath()}>Save workspace</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Harness port" hint="Used when free; otherwise DeepDeck picks the next free port.">
            <div className="flex gap-2">
              <Input value={port} onChange={event => setPort(event.target.value)} inputMode="numeric" aria-label="Harness port" />
              <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void applyPort()}>Save</Button>
            </div>
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader title="First run" detail="The welcome sheet explains the two modes. You can show it again without resetting anything else." />
        <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void save({ firstRun: true }, "The welcome sheet will show on the next launch.")}>
          <RotateCcw size={13} />Show welcome again
        </Button>
      </section>

      <section className="space-y-3">
        <SectionHeader title="Keyboard shortcuts" detail="These work from Chat, Code, and Settings." />
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {SHORTCUTS.map(shortcut => (
            <div key={shortcut.label} className="flex items-center justify-between gap-3 bg-card px-3 py-2">
              <span className="text-[11px] text-text-muted">{shortcut.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map(key => <Kbd key={key}>{key}</Kbd>)}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-text-faint">
          Shortcuts also work while Chat or Code has focus. <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> is the fastest way to reach a
          setting or workspace action.
        </p>
      </section>

      {action.error && <ErrorBanner message={action.error} />}
      {action.message && <p role="status" className="text-[11px] text-success">{action.message}</p>}
    </div>
  );
}
