# Architecture

DeepDeck is a small Electron shell around two existing products. It deliberately
does not reimplement either product UI or either authentication system.

## Process map

```
Electron main (Node)
├─ loopback static server        serves frontend/dist to the shell document
├─ HarnessManager                spawns one dsh web child, parses its URL,
│                                exchanges the launch token for a cookie,
│                                owns the authenticated RPC client
├─ ViewManager                   2 × WebContentsView (chat, code)
├─ WebSession                    DeepSeek partition, auth window, Chrome import,
│                                permissions, signed-in probe, sign-out
├─ provider/subagent control     host RPC calls only; no YAML rewriting
└─ Preferences                   ~/.config/deepdeck/config.json (0600, atomic)

Renderer (shell SPA)             top bar, quick-actions palette, Settings,
                                 dialogs, startup/error states
WebContentsView #1               https://chat.deepseek.com (persist:deepseek-chat)
WebContentsView #2               http://127.0.0.1:<port>/?token=… (persist:deepdeck-harness)
```

The shell document is served over a random loopback HTTP origin so the IPC trust
check can compare a real frame origin. Every `ipcMain` handler verifies both the
sending `webContents` and that the sender frame is the shell main frame.

## Why a separate app

The harness repository ships an official private Electron host. It opens no
port, uses `dsh-app://` and framed byte pipes, owns `$DSH_HOME/profiles/desktop`,
and does not publish a Linux release target. DeepDeck needs the public
`dsh web` surface, its own chat tab and Google sign-in, a stable Fedora launcher,
and no version coupling to a packaged harness. A standalone shell over the
documented Web UI and host RPC is the lower-risk composition. The harness
checkout is never modified.

## Harness lifecycle and isolation

DeepDeck launches only its private `@deepseek-ai/dsh` package with a compatible
installed Node (currently 24.9+). There is no fallback to source, pnpm dsh, or an
ambient CLI. Every launch and plugin command gets explicit, private `DSH_HOME`
and `DSH_AGENTS_HOME` values, its version's package-manager PATH, and private
npm/pnpm caches. The configured workspace remains the working directory.

The preferred port is 9411, then the next free port or an OS-assigned port.
The manager parses the authenticated loopback URL, exchanges its token for a
cookie in main, and loads Code in a separate Electron partition. Tokens and
cookies remain in memory; status objects and logs exclude secrets.

Shutdown terminates only DeepDeck's managed process group. Stale process
cleanup requires both the managed marker and the exact private data home;
the official desktop app and downloaded source checkout are never touched.

## Harness updates and migration

`lib/updates.js` discovers non-draft published dsh releases through GitHub,
including prereleases, validates version and toolchain metadata, and installs
exact npm versions in `harness/versions/<version>-<id>/runtime`. Each slot also
has its own `home` and `agents` directories. The owner-only `state.json` names
the active/previous slots, pending release, failed candidate, and interrupted
attempt. Background checks only record a candidate. Next-launch installation
is enabled by default; manual installation is explicit.

A candidate receives a copy of the current private data, or a first-time
read-only import of existing Web data. Desktop profiles, locks, dependencies,
logs, and caches are excluded. Files have separate inodes and restrictive
permissions. Symlinked data cannot redirect updates back to the original home.
Third-party registry plugins retain their installed version when available;
installation-provided dependencies resolve from the new runtime. Selected
out-of-tree official packages follow the new release. External local plugin
references are refused. Profile patches migrate old subagent/preset entry IDs
with the packaged harness's YAML dialect, preserving expressions as data.

A separate probe process verifies authenticated RPC shapes, current settings,
provider/credential reads, selected plugins, preset activation, and real Code
page boot in a hidden Electron window. Only then is the active pointer written
atomically. Failures retain the working runtime and its data. Interrupted
attempts and failed versions do not automatically retry; the next new release
or a manual retry can try again. If the first production process cannot start
immediately after promotion, the pointer is restored before Code can be used.
Native settings operations are serialized with updates and restarts.

Previous and failed private directories are retained for recovery and logs.
Shell updates remain a DeepDeck source pull plus `packaging/install.sh`.

## Harness client navigation

The newer harness client ignores untrusted DOM `.click()` calls for sidebar
navigation. DeepDeck's Harness and Subagents shortcuts resolve the target
element's rectangle with `executeJavaScript`, then dispatch native
`mouseMove`/`mouseDown`/`mouseUp` events to the code `webContents`. The helper is
used for opening Plugins and selecting the workspace row. If a future client
changes its navigation surface, the helper returns `{ opened: false, reason }`
instead of silently claiming success.

Bundle availability, compatibility, and activation come from `pluginManager`
inventory. Selected metadata alone is not proof that provider and tool fibers
activated. Native settings retain host revision fences.

## Shell themes and usage dashboard

The renderer owns six named themes (`system`, `light`, `dark`, `midnight`,
`graphite`, `paper`). CSS variables implement the shell palette; `lib/theme.ts`
holds the labels, preview swatches, and the dark/light classification used by the
Settings → General picker. The app bar has no theme control; Settings is the
single entry to appearance, API usage, and every control plane. The main process
maps each theme to a native window chrome preference and to the embedded
clients' limited `system`/`light`/`dark` setting. A custom dark theme does not
leave the chat page dark while the shell is light, and changing between two
themes in the same family does not reload the real chat page.

`Settings → API usage` embeds `https://platform.deepseek.com/usage` in a third
`WebContentsView` using the isolated `persist:deepseek-platform` session. The
React section measures its host rectangle and hands it to the view manager; the
view is shown only while Settings is open, hides when another section/overlay
opens, and is destroyed with the window. The session has no preload, is
sandboxed, denies permissions except sanitized clipboard writes, blocks private
network hosts, and allows navigation only inside `deepseek.com`. The platform's
own login/cookies are therefore separate from chat and the harness. A toolbar
provides Reload and an external-browser fallback.

## Host RPC

The harness authenticates `/api` with a signed cookie minted by the token URL.
Main posts:

```json
{ "type": "client-request", "rpcId": "…", "method": "settings/mutate",
  "payload": { "args": { "ns": "llm-pi-ai", "ops": [ … ], "expectedRevision": 7 } } }
```

and expects `{ "type": "server-response", "rpcId": "…", "result": { "ok": true, "value": … } }`.
Only these methods are used:

| Area | Methods |
| --- | --- |
| Settings | `settings/describe`, `settings/mutate`, `settings/update` |
| Credentials | `credentials/describe`, `credentials/set`, `credentials/unset` |
| Providers/models | `llm/listProviders`, `llm/listConfigurableProviders`, `llm/discoverModels` |

Writes are revision-fenced by the harness. A concurrent edit produces a conflict
that the UI surfaces and reloads. Secrets never cross to the renderer:
`credentials/describe` returns only configured/source/writable state.

Provider routes are written as `llm-pi-ai.providers.<route>` profiles; the
built-in DeepSeek route lives in `llm-deepseek`; the default model is
`agent-default-model`; subagent delegation is `subagent-model-selection-settings`.

## Chat session and sign-in

Chat runs top-level in `persist:deepseek-chat`. The partition user agent is a
plain Chrome UA, and DeepSeek requests normalize away the `Electron` product
token. The temporary sign-in Chrome is launched with
`--disable-blink-features=AutomationControlled`: current Chrome otherwise
reports `navigator.webdriver=true` whenever remote debugging is enabled, and
Google refuses the account flow for that browser.

- **In-app sign-in** opens a separate top-level `BrowserWindow` on the same
  partition at the DeepSeek sign-in page. It is used for email sign-in. Choosing
  Google there (or on the chat page) is intercepted before Google's blocked
  page; the window closes and the real-Chrome flow starts automatically.
  Success is accepted only when the partition carries a real DeepSeek bearer
  from `localStorage.userToken` and that bearer is accepted by the site's
  `/api/v0/users/current` endpoint. An anonymous visit still has a
  `ds_session_id` cookie, so cookie presence alone is never treated as success.
- **Chrome sign-in** starts real Chrome on a private `--user-data-dir`
  (`~/.local/share/deepdeck/web-browser`) at the DeepSeek sign-in page. A
  watcher probes every 2.2 s over the DevTools protocol, checks every
  `chat.deepseek.com` tab (Google can leave the callback tab open beside the
  signed-in one), and verifies `userToken` against the user endpoint. On a
  verified tab it reads `*.deepseek.com` cookies via `Storage.getCookies` and
  chat-origin localStorage, closes Chrome, and imports the state into the
  persistent partition. `aws-waf-token` and `aws_waf*` state are excluded
  because WAF clearance binds to one browser. If the user closes Chrome first,
  the same profile is read headlessly. The temporary profile is deleted after
  a successful import or a cancel; a failed attempt keeps it for a retry.
  **Show Chrome** uses `Page.bringToFront` and then minimizes DeepDeck; the
  reverse order is never used, so a failed focus cannot leave an empty desktop.
- **Status probing** avoids the false positive from the anonymous
  `ds_session_id`: when a marker exists and the chat view is loaded, main asks
  the page to validate `userToken` against `/api/v0/users/current` (throttled,
  with a startup grace period and loading check). A stale marker is removed.
- **Persistence** is explicit: after a verified sign-in, DeepDeck writes the
  non-WAF DeepSeek cookies and chat localStorage to an owner-only
  `web-session.json`, converting session cookies to a 30-day horizon. The file
  is restored before the chat view loads. Sign-out and failed verification
  delete it.
- **Sign out** clears cookies, localStorage, IndexedDB, and caches for the chat
  partition, removes the marker and any Chrome profile, and reloads the page.

## Native view layout

The shell top bar is 40 CSS pixels. Embedded views occupy the content area
below it, scaled by the current zoom; in Focus mode they start at y=0 and the
bar is not rendered. The bar starts with the DeepDeck wordmark and deliberately
has no whale: Chat and Code each show the official mark in their own upper-left
page sidebar, and DeepDeck does not duplicate it in the very top-left corner.
The bar also carries the mode tabs, a workspace chip that opens the configured
folder, the harness state (which opens the Harness settings), quick actions,
account, and Settings. Any
shell surface that must paint below the bar (Settings, the account panel, the
quick-actions palette, dialogs) hides the native views through the overlay
signal described below; a top-bar dropdown cannot do that, which is why the
workspace chip is a direct open action and the multi-action workspace menu lives
inside the palette. `WebContentsView` bounds do not follow a `BrowserWindow`
resize on their own, so the window's `resize`, maximize, unmaximize, and
full-screen events all call `ViewManager.layout()`. The harness view also has a
small preload that replaces the sidebar brand SVG with the DeepSeek web-chat
whale (the same 27x24 path used by the chat sidebar and the installed icons);
it only moves DOM nodes and never reads harness data. Without that, resizing to
the 960×600 minimum leaves the page laid out at the old width and clipped to
the right. On first launch DeepDeck selects the configured workspace
through the harness composer's own workspace menu (no session is created) and
records that it did so; the setting is reset if the workspace path changes.
The appearance control is in **Settings → General**. A theme change writes the
shell preference, maps the custom theme to the embedded clients' light/dark/
system setting, and updates the harness `ui-theme` namespace. The chat view is
reloaded only when the mapped family changes; switching Dark → Midnight keeps the
draft. The API usage dashboard is a third native view; it is positioned from the
React host's measured rectangle, shown only inside Settings, hidden by overlays
or when leaving the section, and isolated in its own session.
Views are hidden while Settings or a shell overlay is open:
Electron native views always paint above the shell document, so a React dialog
cannot cover them. The shell signals its overlay state, and the ViewManager
shows only the active view otherwise.

## Chat attachments

DeepSeek's composer uses a hidden `<input type=file>`; Chromium's chooser and
Electron's `dialog.showOpenDialog` cannot share a starting directory. The chat
preload therefore listens for the input's click in the capture phase, cancels
the native chooser, and asks main for files:

1. Main checks that the IPC sender is exactly the live chat view, opens
   `dialog.showOpenDialog` with `defaultPath` set to the configured workspace
   (and a title naming it), and reads the selected files asynchronously.
2. It returns `{ name, type, size, lastModified, data }` records. The sum is
   capped at 96 MB per selection and 64 MB per file, below the structured-clone
   ceiling; an over-limit selection shows a native warning and attaches nothing.
3. The preload constructs real `File` objects, assigns them through a
   `DataTransfer` to the site's input, and dispatches `change`. The site then
   renders its normal upload chips and uploads them itself. No page internals
   are rewritten.
4. If the IPC call fails, the original click is replayed so Chromium's native
   chooser still works. Cancelling the dialog leaves the composer untouched.

The same workspace is exposed in the app bar (click to open the folder) and in
the quick-actions palette (open, open Documents, copy path, reveal in Code,
attach files to Chat, set chat folder, change workspace). The palette's
**Attach files to DeepSeek chat** action calls `web:attach-files`; main switches
to Chat, clears Settings/focus mode, and clicks the composer's file input with a
user gesture.

The chat preload injects one composer-adjacent folder button. It no longer
uploads a folder sample: clicking it calls `webchat:grant-directory`, which
opens a native directory picker and stores a **chat folder** in preferences.
That grant reads and uploads nothing, and the page receives only the folder's
display name through `webchat:directory`. The paperclip picker uses the chat
folder as its `defaultPath` (falling back to the workspace), so the remote page
can receive files only when the user explicitly selects them. A remote web page
cannot browse a local directory; this is the safe local-access boundary. The
Settings/Web account copy and the native confirmation state that limitation.

`app.setPath("documents", workspace)` is also kept in sync for Chromium-owned
dialogs that do not take an explicit default directory.

## Brand assets

The Chat and Code page sidebars use the 27x24 SVG path from the official web-chat
sidebar (`frontend/src/components/DeepSeekMark.tsx` supplies the shell copy).
The app bar intentionally has no whale, because the same mark is already in the
page sidebar immediately below it. The installed application icon is the official
`icon-512.png` from the chat manifest, resized to the hicolor sizes; the scalable
icon is the official whale path on a white rounded tile. No favicon-approximation
artwork is used in the page sidebars.

## Security boundaries

- Shell preload is minimal and only on the shell document.
- The chat view's preload restores Chrome-imported localStorage, bridges the
  page's hidden file input to a native picker, and adds one local-access
  composer button (folder+). It exposes nothing to the page and accepts only
  files the user selects or confirms in a picker.
- External navigation is blocked or handed to the system browser; only https
  URLs are opened externally.
- Downloads use the native save dialog.
- Chat permissions are deny-by-default and origin-scoped. The only allowed
  permission is `clipboard-sanitized-write` on `https://chat.deepseek.com`;
  camera, microphone, geolocation, notifications, fullscreen, clipboard reads,
  file-system access, and display capture are rejected without a site-triggered
  dialog. Notifications are also removed at the page API level so a cached grant
  or a service worker cannot surface them.
- The chat partition cancels requests to loopback, RFC1918 private, CGNAT,
  link-local, and mDNS hostnames (and logs each blocked host once). The remote
  page therefore cannot reach the harness, the shell's loopback static server,
  or other local services by literal address. Chromium's origin/CORS rules still
  apply; this is a hostname filter, not a DNS-rebinding-proof sandbox.
- The credential store and harness settings are the harness's responsibility;
  DeepDeck never stores a key in its own config or logs.

## Provider environment and defaults

`provider-env.js` reads `~/.local/share/opencode/auth.json` at harness start and
maps the existing OpenCode keys to `MISTRAL_API_KEY`, `ZAI_API_KEY`,
`Z_AI_API_KEY`, `MINIMAX_API_KEY`, and `OPENCODE_API_KEY`. The mapping is passed
only in the managed harness child's environment; no key is written to
`settings.yaml`, logs, or the shell. An explicit value already in the app
environment wins.

When the harness becomes ready, `provider-defaults.js` adds any missing
`llm-pi-ai.providers` routes for Z.ai, Mistral, MiniMax, and OpenCode Go. The
first three use the catalog provider defaults. OpenCode Go is also a first-class
catalog route: its models use mixed Anthropic-messages, OpenAI-completions, and
OpenAI-responses protocols with per-model base URLs, so the route carries only
`displayName` and `apiKeyEnv`; a route-level `api`, `baseURL`, or explicit model
list would override the catalog and break those models. A legacy DeepDeck route
at `https://opencode.ai/zen/go/v1` with a forced protocol is migrated back to the
bare catalog profile. The function checks the current settings revision, sends
one mutation, and leaves unrelated custom profiles untouched. A small
owner-only seed file under the DeepDeck config records which defaults have been
offered, so deleting a provider later is not undone on the next launch. The
default model is not changed.

## Optional product subagents

The built-in spawn/fork providers come from shipped presets. Optional backends
are managed through the host's offered `installTarget`, enable, and remove
operations inside DeepDeck's private profile. No native coding process starts
until the user actually delegates.

DeepDeck Full is a declarative local bundle registered through `installBundle`,
with current Standard composition obtained through `agentPresets/read`.
Enabled backend bundles provide global tools. The default is persisted through
`agent-preset-registry.selectedDefault` after verifying the roster. Generated
compositions carry hashes so an update can refresh unmodified Standard-based
content and refuse to overwrite edits. Legacy custom YAML is wrapped in a
supported bundle and retained; an invalid first import falls back to Standard
with a migration notice. Native Codex/Claude login remains authoritative.

## Known constraints

- `dsh web` has no attach API and no persistent launch token; DeepDeck must own
  the process it embeds.
- DeepDeck and the official app do not synchronize history after the initial
  read-only copy. Their runtime and data homes are independent.
- A changed harness port changes the view origin and therefore browser-local UI
  state.
- DeepSeek web and API accounts are separate.
- A chat attachment selection is capped at 64 MB per file / 96 MB total because
  the selected bytes cross the shell IPC boundary; larger files can still be
  dragged or chosen through the site's own picker.
