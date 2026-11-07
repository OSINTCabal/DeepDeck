import * as React from "react";
import { bridge, errorMessage, hasBridge, unwrap, type AppState, type Mode } from "@/lib/bridge";
import { applyTheme } from "@/lib/theme";
import { AccountPanel } from "@/components/AccountPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { DeepSeekMark } from "@/components/DeepSeekMark";
import { SettingsView, type SettingsSection } from "@/components/SettingsView";
import { SignInDialog } from "@/components/SignInDialog";
import { StartupPanel, ChatEmptyPanel } from "@/components/StartupPanel";
import { TopBar } from "@/components/TopBar";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { Button } from "@/components/ui";

function Splash({ message }: { message: string }) {
  return (
    <div className="grid h-full place-items-center bg-background">
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border bg-card text-brand">
          <DeepSeekMark size={25} title="DeepSeek" />
        </div>
        <p className="mt-3 text-sm font-medium text-text">DeepDeck</p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <span className="dd-spinner" aria-hidden="true" />{message}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const available = hasBridge();
  const [state, setState] = React.useState<AppState | null>(null);
  const [fatal, setFatal] = React.useState<string | null>(null);
  const [accountOpen, setAccountOpen] = React.useState(false);
  const [welcomeOpen, setWelcomeOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [section, setSection] = React.useState<SettingsSection>("general");
  const accountTrigger = React.useRef<HTMLElement | null>(null);
  const settingsTrigger = React.useRef<HTMLElement | null>(null);

  const refresh = React.useCallback(async () => {
    if (!available) return;
    try {
      setState(await bridge().getState());
    } catch (error) {
      setFatal(errorMessage(error));
    }
  }, [available]);

  React.useEffect(() => {
    if (!available) return;
    const api = bridge();
    let disposed = false;
    const off = api.onState(next => { if (!disposed) setState(next); });
    void api.getState().then(next => {
      if (disposed) return;
      setState(next);
      if (next.prefs.firstRun) setWelcomeOpen(true);
    }).catch(error => { if (!disposed) setFatal(errorMessage(error)); });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      off();
      window.removeEventListener("focus", onFocus);
    };
  }, [available, refresh]);

  React.useEffect(() => {
    if (!state) return;
    applyTheme(state.prefs.theme);
  }, [state?.prefs.theme]);

  const signInOpen = Boolean(state && state.web.phase !== "idle");
  const overlay = accountOpen || welcomeOpen || signInOpen || paletteOpen;

  React.useEffect(() => {
    if (!available) return;
    void bridge().setOverlay(overlay).then(next => setState(next)).catch(() => {});
  }, [available, overlay]);

  React.useEffect(() => {
    if (signInOpen && accountOpen) setAccountOpen(false);
  }, [signInOpen, accountOpen]);

  React.useEffect(() => {
    if (signInOpen && paletteOpen) setPaletteOpen(false);
  }, [signInOpen, paletteOpen]);

  const closePalette = React.useCallback(() => setPaletteOpen(false), []);

  const togglePalette = React.useCallback(async () => {
    if (!available) return;
    if (paletteOpen) {
      setPaletteOpen(false);
      return;
    }
    const api = bridge();
    try {
      // Settings and the palette both own the whole window. Close settings
      // first so its focus-restore effect cannot steal the palette's input.
      if (state?.settingsOpen) setState(await api.setSettings(false));
    } catch { /* the palette can still open */ }
    setAccountOpen(false);
    setWelcomeOpen(false);
    setPaletteOpen(true);
  }, [available, paletteOpen, state?.settingsOpen]);

  React.useEffect(() => {
    if (!available) return;
    const off = bridge().onCommand(command => {
      if (command?.type === "palette") void togglePalette();
    });
    return off;
  }, [available, togglePalette]);

  const switchMode = async (mode: Mode) => {
    if (!available) return;
    const api = bridge();
    try {
      if (state?.settingsOpen) await api.setSettings(false);
      setState(await api.setMode(mode));
      setAccountOpen(false);
      setWelcomeOpen(false);
      setPaletteOpen(false);
    } catch (error) {
      setFatal(errorMessage(error));
    }
  };

  const openSettings = async () => {
    if (!available) return;
    const api = bridge();
    try {
      setAccountOpen(false);
      setWelcomeOpen(false);
      setPaletteOpen(false);
      setState(await api.setSettings(true));
    } catch (error) {
      setFatal(errorMessage(error));
    }
  };

  const openSettingsSection = async (next: SettingsSection) => {
    if (!available) return;
    const api = bridge();
    setSection(next);
    try {
      setAccountOpen(false);
      setWelcomeOpen(false);
      setPaletteOpen(false);
      setState(await api.setSettings(true));
    } catch (error) {
      setFatal(errorMessage(error));
    }
  };

  const closeSettings = async () => {
    if (!available) return;
    try {
      setState(await bridge().setSettings(false));
    } catch (error) {
      setFatal(errorMessage(error));
    }
  };

  const openAccount = async () => {
    if (!available) return;
    setPaletteOpen(false);
    if (!accountOpen) {
      accountTrigger.current = document.querySelector<HTMLElement>('button[aria-label="DeepSeek web account"]')
        || document.activeElement as HTMLElement | null;
    }
    const api = bridge();
    if (state?.focusMode) {
      try { setState(await api.setFocus(false)); } catch { /* best effort */ }
    }
    setAccountOpen(value => !value);
  };

  const revealWorkspace = async () => {
    if (!available) return;
    await switchMode("code");
    try {
      await unwrap(bridge().harness.revealWorkspace());
    } catch {
      // The palette/menu already closed. The workspace is visible in Settings
      // if the harness cannot select it yet.
    }
  };

  React.useEffect(() => {
    if (!accountOpen && accountTrigger.current?.isConnected) accountTrigger.current.focus();
  }, [accountOpen]);

  React.useEffect(() => {
    if (state?.settingsOpen) {
      settingsTrigger.current = document.activeElement as HTMLElement | null;
    } else {
      const target = settingsTrigger.current?.isConnected
        ? settingsTrigger.current
        : document.querySelector<HTMLElement>('button[aria-label="Open settings"]');
      target?.focus();
    }
  }, [state?.settingsOpen]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void togglePalette();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (paletteOpen) {
        event.preventDefault();
        setPaletteOpen(false);
      } else if (state?.settingsOpen) {
        event.preventDefault();
        void closeSettings();
      } else if (accountOpen) {
        event.preventDefault();
        setAccountOpen(false);
      } else if (state?.focusMode) {
        event.preventDefault();
        void bridge().setFocus(false).then(setState).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state?.settingsOpen, state?.focusMode, accountOpen, paletteOpen, togglePalette]);

  const dismissWelcome = async () => {
    setWelcomeOpen(false);
    try {
      await bridge().savePreferences({ firstRun: false });
      await refresh();
    } catch { /* the dialog still closes */ }
  };

  const startSignIn = async () => {
    setWelcomeOpen(false);
    try {
      await unwrap(bridge().web.beginChromeSignIn());
      await refresh();
    } catch (error) {
      setFatal(errorMessage(error));
    }
  };

  if (!available) {
    return (
      <div className="grid h-full place-items-center bg-background p-8 text-center">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold text-text">DeepDeck desktop</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            This page must run inside the DeepDeck desktop shell. Start DeepDeck from your app menu or run{" "}
            <span className="mono">DeepDeck</span> in a terminal.
          </p>
        </div>
      </div>
    );
  }

  if (!state) {
    return fatal
      ? (
        <div className="grid h-full place-items-center bg-background p-8">
          <div className="max-w-md text-center">
            <p className="text-sm font-medium text-text">DeepDeck could not load its state</p>
            <p className="mt-2 break-words text-xs text-danger">{fatal}</p>
            <Button className="mt-4" onClick={() => void refresh()}>Retry</Button>
          </div>
        </div>
      )
      : <Splash message="Opening your desktop…" />;
  }

  const harnessReady = state.harness.state === "ready";
  const content = state.settingsOpen ? (
    <SettingsView
      state={state}
      section={section}
      onSection={setSection}
      onClose={() => void closeSettings()}
      onRefresh={refresh}
      onMode={mode => void switchMode(mode)}
    />
  ) : state.mode === "code" ? (
    harnessReady && state.views?.hasCode && state.views.code.state === "ready"
      ? <div className="h-full bg-background" />
      : <StartupPanel state={state} onRefresh={refresh} onChat={() => void switchMode("chat")} onSettings={() => void openSettings()} />
  ) : state.views?.hasChat ? (
    <div className="h-full bg-background" />
  ) : (
    <ChatEmptyPanel state={state} />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {!state.focusMode && (
        <TopBar
          mode={state.mode}
          onMode={mode => void switchMode(mode)}
          settingsOpen={state.settingsOpen}
          onSettings={() => {
            if (state.settingsOpen) void closeSettings();
            else void openSettings();
          }}
          onOpenSettings={next => void openSettingsSection(next)}
          onPalette={() => void togglePalette()}
          onAccount={() => void openAccount()}
          web={state.web}
          harness={state.harness}
          workspace={state.prefs.harness.workdir}
          updateAvailable={Boolean(state.updates?.harness?.pendingVersion)}
        />
      )}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {state.overlayOpen && !state.settingsOpen && state.views?.backdrop && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <img
              src={state.views.backdrop}
              alt=""
              className="h-full w-full scale-[1.03] object-cover opacity-55 blur-[2px]"
            />
            <div className="absolute inset-0 bg-background/45" />
          </div>
        )}
        {content}
        {accountOpen && (
          <AccountPanel
            state={state}
            onClose={() => setAccountOpen(false)}
            onSettings={() => void openSettings()}
            onRefresh={refresh}
          />
        )}
      </main>
      <WelcomeDialog
        open={welcomeOpen && !signInOpen}
        onClose={() => void dismissWelcome()}
        onSignIn={() => void startSignIn()}
        onCode={() => { void dismissWelcome(); void switchMode("code"); }}
      />
      <SignInDialog state={state} onRefresh={refresh} />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        state={state}
        onMode={mode => void switchMode(mode)}
        onSettings={next => void openSettingsSection(next)}
        onRefresh={refresh}
        onAccount={() => void openAccount()}
        onRevealWorkspace={() => void revealWorkspace()}
      />
    </div>
  );
}
