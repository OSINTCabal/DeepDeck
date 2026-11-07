/** Typed access to the preload bridge and the app's read models. */

export interface WindowState {
  maximized: boolean;
  minimized: boolean;
  fullscreen: boolean;
}

export type Mode = "chat" | "code";
export type Theme = "system" | "light" | "dark" | "midnight" | "graphite" | "paper";

export interface Preferences {
  version: number;
  mode: Mode;
  theme: Theme;
  zoom: number;
  firstRun: boolean;
  window: { width: number; height: number; maximized: boolean; x: number | null; y: number | null };
  harness: {
    workdir: string;
    port: number;
  };
  web: { signedIn: boolean; lastSignInAt: string | null; chatDirectory: string | null };
  updates: { autoCheck: boolean; autoUpdate: boolean };
}

export interface HarnessStatus {
  state: "stopped" | "preparing" | "starting" | "ready" | "stopping" | "error";
  port: number | null;
  origin: string | null;
  pid: number | null;
  workdir: string;
  runtimeDir: string | null;
  home: string | null;
  version: string | null;
  logFile: string;
  startedAt: string | null;
  error: string | null;
  kind: string | null;
}

export interface WebStatus {
  signedIn: boolean;
  method: string | null;
  signedInAt: string | null;
  cookieCount: number;
  busy: boolean;
  phase: "idle" | "in-app" | "waiting-chrome" | "importing" | "error";
  detail: string;
  chromeAvailable: boolean;
}

export type UpdateState = "not-installed" | "up-to-date" | "pending" | "failed";
export interface RuntimeUpdateStatus {
  logFile: string | null;
  state: UpdateState;
  version: string | null;
  pendingVersion: string | null;
  runtimeDir: string | null;
  home: string | null;
  agentsHome: string | null;
  canUpdate: boolean;
  checkedAt: string | null;
  error: string | null;
  failedVersion: string | null;
  releaseUrl: string;
  migrationWarning: string | null;
}
export interface AppUpdateInfo {
  version: string;
  appRoot: string;
  installed: boolean;
  kind: "installed" | "source";
  message: string;
}
export interface UpdatesView {
  busy: boolean;
  startedAt: string | null;
  checking: boolean;
  checkedAt: string | null;
  error: string | null;
  progress: string | null;
  harness: RuntimeUpdateStatus | null;
  app: AppUpdateInfo | null;
  autoCheck: boolean;
  autoUpdate: boolean;
}
export interface ApplyUpdateResult {
  updated: boolean;
  version: string;
  previousVersion: string | null;
  harness: RuntimeUpdateStatus;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface Envelope<T> {
  ok: boolean;
  value?: T;
  error?: ApiError;
}

export interface AppState {
  platform: string;
  version: string;
  shellOrigin: string | null;
  mode: Mode;
  settingsOpen: boolean;
  overlayOpen: boolean;
  focusMode: boolean;
  zoom: number;
  prefs: Preferences;
  harness: HarnessStatus;
  web: WebStatus;
  updates: UpdatesView | null;
  views: {
    mode: Mode;
    settingsOpen: boolean;
    overlayOpen: boolean;
    backdrop?: string | null;
    focusMode: boolean;
    chat: { state: string; detail: string };
    code: { state: string; detail: string };
    zoom: number;
    hasChat: boolean;
    hasCode: boolean;
  } | null;
  paths: {
    configFile: string;
    dataDir: string;
    logsDir: string;
    harnessLog: string;
    webMarker: string;
  };
  versions: { electron: string; chrome: string; node: string };
}

export interface ModelSummary {
  id: string;
  name: string;
}

export interface KeyState {
  configured: boolean;
  source: string | null;
  writable: boolean;
  required?: boolean;
}

export interface ProviderView {
  provider: string;
  name: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  configured: boolean;
  active: boolean;
  builtin: boolean;
  synthetic: boolean;
  custom: boolean;
  oauthOnly: boolean;
  note: string;
  order: number;
  apiKeyEnv: string;
  key: KeyState;
  baseURL: string | null;
  api: string | null;
  models: ModelSummary[] | null;
  error?: string;
}

export interface DefaultModel {
  provider: string | null;
  model: string | null;
  reasoningEffort: string | null;
}

export interface ProvidersView {
  writable: boolean;
  providers: ProviderView[];
  active: string[];
  defaultModel: DefaultModel | null;
  revisions: Record<string, number>;
  apiProtocols: string[];
  discovery?: ModelSummary[];
}

export interface SubagentCandidate {
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  available: boolean;
  selected: boolean;
}

export interface BackendStatus {
  kind: string;
  label: string;
  package: string;
  provider: string;
  installed: boolean;
  hasBundle: boolean;
  version: string | null;
  runtimeVersion: string | null;
  compatible: boolean | null;
  bundleActive: boolean;
  nativeAuth: boolean;
  authHint: string;
  error: string | null;
}

export interface SubagentsView {
  writable: boolean;
  enabled: boolean;
  allowedModels: Array<{ provider: string; model: string }>;
  candidates: SubagentCandidate[];
  revisions: Record<string, number>;
  builtIn: Array<{ provider: string; label: string; mode: string; detail: string }>;
  preset: {
    default: string | null;
    deepdeckFull: boolean;
    broken: string | null;
    revision: number | null;
  };
  backends: BackendStatus[];
}

export interface ProgressEvent {
  phase: string;
  message: string;
}

interface DeepDeckBridge {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): () => void;
  setMode(mode: Mode): Promise<AppState>;
  setSettings(open: boolean): Promise<AppState>;
  setOverlay(open: boolean): Promise<AppState>;
  setTheme(theme: Theme): Promise<Theme>;
  setFocus(focus: boolean): Promise<AppState>;
  pickDirectory(kind?: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  quit(): Promise<boolean>;
  savePreferences(patch: Partial<Preferences> & Record<string, unknown>): Promise<Preferences>;
  onCommand(cb: (command: { type: string }) => void): () => void;
  workspace: {
    openFolder(): Promise<boolean>;
    openDocuments(): Promise<boolean>;
    copyPath(): Promise<boolean>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    getState(): Promise<WindowState>;
    onState(cb: (state: WindowState) => void): () => void;
  };
  zoom: { get(): Promise<number>; set(factor: number): Promise<number> };
  harness: {
    status(): Promise<HarnessStatus>;
    restart(): Promise<Envelope<HarnessStatus>>;
    reload(): Promise<Envelope<boolean>>;
    openLog(): Promise<boolean>;
    openConfigFolder(): Promise<boolean>;
    openSettings(section: string): Promise<Envelope<{ opened: boolean; reason?: string }>>;
    revealWorkspace(): Promise<Envelope<{ revealed: boolean; title?: string; reason?: string }>>;
    onState(cb: (state: HarnessStatus) => void): () => void;
  };
  updates: {
    check(): Promise<Envelope<UpdatesView>>;
    apply(): Promise<Envelope<ApplyUpdateResult>>;
  };
  usage: {
    show(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean>;
    hide(): Promise<boolean>;
    reload(): Promise<boolean>;
  };
  web: {
    status(): Promise<WebStatus>;
    grantDirectory(): Promise<Envelope<{ granted: boolean; canceled?: boolean; name?: string }>>;
    signInInApp(): Promise<Envelope<WebStatus>>;
    beginChromeSignIn(): Promise<Envelope<WebStatus>>;
    focusChrome(): Promise<Envelope<WebStatus>>;
    confirmChromeSignIn(accepted: boolean): Promise<Envelope<WebStatus>>;
    cancelSignIn(): Promise<Envelope<WebStatus>>;
    signOut(): Promise<Envelope<WebStatus>>;
    reloadChat(): Promise<boolean>;
    attachFiles(): Promise<boolean>;
    onState(cb: (state: WebStatus) => void): () => void;
  };
  providers: {
    list(): Promise<Envelope<ProvidersView>>;
    save(input: Record<string, unknown>): Promise<Envelope<ProvidersView>>;
    remove(provider: string, removeKey: boolean): Promise<Envelope<ProvidersView>>;
    setKey(input: Record<string, unknown>): Promise<Envelope<ProvidersView>>;
    removeKey(input: Record<string, unknown>): Promise<Envelope<ProvidersView>>;
    setDefault(input: Record<string, unknown>): Promise<Envelope<ProvidersView>>;
    discover(input: Record<string, unknown>): Promise<Envelope<ModelSummary[]>>;
  };
  subagents: {
    list(): Promise<Envelope<SubagentsView>>;
    save(input: Record<string, unknown>): Promise<Envelope<SubagentsView>>;
    install(kind: string, options?: Record<string, unknown>): Promise<Envelope<SubagentsView>>;
    uninstall(kind: string): Promise<Envelope<SubagentsView>>;
    createPreset(kinds: string[]): Promise<Envelope<unknown>>;
    removePreset(): Promise<Envelope<SubagentsView>>;
    onProgress(cb: (event: ProgressEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    deepdeck?: DeepDeckBridge;
  }
}

export class BridgeError extends Error {
  code: string;
  details?: unknown;
  constructor(error: ApiError) {
    super(error.message);
    this.name = "BridgeError";
    this.code = error.code;
    this.details = error.details;
  }
}

export function bridge(): DeepDeckBridge {
  if (!window.deepdeck) throw new Error("DeepDeck bridge is unavailable");
  return window.deepdeck;
}

export function hasBridge(): boolean {
  return Boolean(window.deepdeck);
}

export async function unwrap<T>(promise: Promise<Envelope<T>>): Promise<T> {
  const result = await promise;
  if (!result || result.ok !== true) {
    throw new BridgeError(result?.error || { code: "UNKNOWN", message: "The desktop operation failed" });
  }
  return result.value as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof BridgeError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
