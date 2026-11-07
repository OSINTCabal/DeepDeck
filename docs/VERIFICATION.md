# Verify DeepDeck

All automated checks below use temporary state where they start a harness. They
do not mutate `~/.dsh`, the user's settings, or other running harness processes.

## Automated

```bash
cd /path/to/DeepDeck

# frontend typecheck + build + main-process tests
bash scripts/check.sh

# throwaway-DSH_HOME harness launch, token exchange, RPC reads
node scripts/smoke-harness.mjs

# additionally add/remove a synthetic route in the throwaway home
node scripts/smoke-harness.mjs --full
```

The shell suite covers visible preparation, repeated Start requests, setup retry,
package diagnostics, mounted-page readiness and renderer crashes, isolated migration, unchanged official data, update
promotion, dependency/migration/RPC/page failures, interruption, cancellation,
manual retry, startup rollback, current settings namespaces and revision fences,
preset bundles and custom edits, actual plugin activation, authenticated RPC
envelopes, and existing chat/security/provider behavior.

For release compatibility including real Electron boot (Linux needs a display
or Xvfb):

```sh
xvfb-run -a node scripts/smoke-harness.mjs --latest --full --page
```

This installs only into a temporary directory and makes no model calls. A
CI job runs it on pushes, pull requests, and daily against the newest published release. The page
check uses the production WebContentsView, sandbox settings, and Code preload;
document load alone does not establish readiness. Network, socket,
or process restrictions are verification failures to report, not reasons to
weaken the checks or run against the user's real harness.

## Manual acceptance checklist

Use a **fresh** installed build. The existing harness on another port should
remain untouched throughout.

1. **Launch**
   - `DeepDeck` from a terminal and from the app drawer.
   - Window opens without a terminal; second launch focuses the existing one.
   - First launch shows the welcome sheet; “Set up later” persists.
2. **Chat**
   - The page is the real `chat.deepseek.com`; “Log in with Google” is visible.
   - DevTools user agent contains `Chrome/…` and no `Electron/…`.
   - Cookie banner, history, upload, search/DeepThink controls behave as on the
     site.
   - Click the paperclip: the native picker is titled “Attach files from
     <workspace>” and lists the configured workspace. Select a small text file:
     the composer shows the site's normal attachment chip with the right name,
     type, and byte count. Remove it; the composer is empty.
   - Cancel the picker: nothing is attached and the composer is unchanged.
   - Try a file over 64 MB or a selection over 96 MB: a native warning is shown
     and nothing is attached.
   - The composer has one extra DeepDeck folder button beside the site
     paperclip; the app-bar workspace chip is the only "open the directory"
     control. Clicking folder opens a native directory picker; choosing a
     fixture only stores it as the chat folder. Nothing is read, uploaded, or
     shown as an attachment chip. The native confirmation explains that the
     remote page cannot browse the directory.
   - The site's paperclip has the accessible name “Attach files from the chat
     folder”. Its picker starts in the granted folder. A mouse click on folder
     does not leave a persistent focus ring; keyboard focus does show one.
   - From DevTools, `document.querySelector('[data-deepdeck-local-button="folder"]').click()`
     and `document.querySelector('input[type=file]').click()` do not open a local
     picker. A real mouse click on either, or the shell palette action, does.
   - Focus mode (`Ctrl+Shift+F`) hides the bar; `Esc` restores it.
3. **Google sign-in**
   - The account menu/welcome button opens a real Chrome window at the DeepSeek
     sign-in page. Chrome shows no Google “browser may not be secure” error.
     On the DeepSeek and Google pages, `navigator.webdriver` is `false`.
   - Choosing Google inside the in-app page or on the chat page reroutes to
     Chrome automatically; the in-app window closes and the app shows the
     Chrome-waiting instructions.
   - **Show Chrome** raises Chrome and minimizes DeepDeck. If Chrome cannot be
     focused, DeepDeck stays visible with an error instead of hiding.
   - Finish Google in Chrome until the DeepSeek chat appears; the watcher
     imports automatically, closes Chrome, verifies the chat inside DeepDeck,
     and deletes the temporary profile.
   - Repeat, but close Chrome before the watcher imports. DeepDeck reads the
     saved profile headlessly and imports the session. If signed out, it
     restores with an inline error; a failed attempt keeps the profile.
   - **I have signed in** forces an immediate import and returns a clear
     signed-out message in a few seconds when the tab has no token.
   - Restart DeepDeck; the chat is still signed in.
   - Sign out clears the partition and reloads signed out; restart remains
     signed out.
4. **Code**
   - During first setup, Preparing Code and elapsed package-install progress remain
     visible. Start is disabled while setup runs; switching to Chat still works.
   - Cancel setup by closing DeepDeck, relaunch, and retry Code. The real setup
     log is available, and an npm warning does not hide cancellation or failures.
   - A plugin boot failure or renderer crash shows diagnostics in the shell
     rather than leaving an empty native view covering them.
   - The real dsh Web GUI loads; existing workspaces/sessions from `~/.dsh`
     are present.
   - The harness process cwd is the configured workspace (for example
     `~/Documents/DeepDeck`), and the composer
     workspace chip shows that workspace on the first run.
   - The default model is the configured one (for example
     `deepseek-official` / `deepseek-flash`).
   - Send a prompt in a new session and see it stream.
   - `Settings → Harness → Open Models` opens the harness Models dialog.
   - Reveal default workspace selects the matching sidebar workspace.
5. **Shell chrome and quick actions**
   - The app bar shows the official DeepSeek whale, not a speech bubble, at the
     far left; the installed app icon is the official white/blue whale tile.
   - The workspace chip in the app bar names the configured folder and opens it
     in the file manager on click; the title shows the full path.
   - `Ctrl+K` opens the quick-actions palette from Chat, Code, Settings, and
     focus mode. Typing filters; Arrow keys move the selection; Enter runs it;
     Esc closes it. Switching mode, opening a Settings section, restarting the
     harness, and opening the workspace folder all work from the palette.
   - The search icon in the app bar opens the same palette. The status chip
     opens Settings → Harness.
   - The palette closes cleanly over light and dark backdrops and returns the
     keyboard to the shell; mode switches focus the embedded page again.
6. **Local integration and safety**
   - From Code mode, `Ctrl+K` → **Attach files to DeepSeek chat** switches to
     Chat and opens “Attach files from <workspace>”. Select a source file; the
     composer shows the normal attachment chip. Remove it.
   - The Web account page’s **Attach files** and **Set chat folder** buttons
     perform the same actions. Setting a folder reads nothing; cancelling either
     picker changes nothing.
   - **Ctrl+K → Set chat folder…** opens the same folder grant from either mode,
     and **Ctrl+K → Open Documents folder** opens the real `~/Documents` (or home
     when it does not exist).
   - In Chat, open DevTools (`Ctrl+Shift+I`) and check the permission surface:
     - `Notification.requestPermission()` resolves `denied`; `new Notification()`
       creates nothing, and `navigator.permissions.query({name:'notifications'})`
       is denied.
     - `navigator.mediaDevices.getUserMedia({audio:true})` rejects with
       `NotAllowedError`; no camera/microphone permission dialog appears.
     - `navigator.geolocation.getCurrentPosition` fails with error code 1.
     - `navigator.clipboard.readText()` is rejected; clipboard write from the
       site’s copy buttons still works when the DeepDeck window is focused.
     - `fetch('http://127.0.0.1:9411/', {mode:'no-cors'})` rejects, and the log
       records `chat: blocked a local network request (127.0.0.1)`. Repeat with
       `localhost` and a private LAN address.
   - The chat page still loads, signs in, and uploads the files selected in the
     picker after these guards are enabled.
7. **Updates**
   - Confirm the version and private data home, pending release, diagnostics,
     automatic checks, and next-launch policy.
   - Discovering a release leaves a running Code session alone. The next launch
     prepares a new slot, validates the actual page, and switches atomically.
   - Inject installation, migration, and boot failures in temporary tests;
     confirm the previous runtime and its sessions remain usable.
   - After an interrupted update, the working slot remains active; a failed
     release waits for Retry or a newer release.
   - Compare downloaded harness and official-home files before/after setup,
     provider/subagent edits, update failure, promotion, and app reinstall.
   - The shell card explains source pull plus `packaging/install.sh`.
8. **Providers**
   - The live provider directory appears; active routes and key state match the
     harness Models page.
   - Add a custom OpenAI-compatible route; it appears in the harness Models
     page without a restart. Remove it.
   - Set a key; the harness Models page shows the credential as configured.
     Environment-managed keys are read-only.
   - Set a different default model; a new session picks it up. Existing
     sessions keep their recorded model.
   - Removing the provider that owns the default is refused until another
     default is chosen.
   - The active set includes Mistral, MiniMax, Z.ai, and OpenCode Go. Each of
     the four returns models through **Discover models** (this exercises the
     provider key). OpenCode Go shows the display name “OpenCode Go” and its 27
     catalog models; it has no route-level base URL or API protocol override.
   - The managed harness process environment contains MISTRAL_API_KEY,
     MINIMAX_API_KEY, ZAI_API_KEY, and OPENCODE_API_KEY names. No key value
     appears in settings or logs.
9. **Subagents**
   - Model-selection edits use `subagent-model-selection-settings` and agree
     with native Plugins. Missing namespaces show an explicit error.
   - Enable/disable a private backend. Active status requires provider and tool
     fibers to activate. Installation alone does not invoke the native agent.
   - Compose DeepDeck Full, verify it in the host roster, select it as the new
     default, and remove it. Original harness profiles remain unchanged.
   - Edit a generated preset in a disposable private installation. Automatic
     updates refuse to replace it; the working installation remains intact.
10. **Process hygiene**
   - Close the window: DeepDeck and its harness child exit; port 9411 is free.
   - Start DeepDeck again: a stale managed child from a crashed instance is
     cleaned up, never an unrelated harness.
   - Logs contain `token=<redacted>` and no API key values.
11. **Visual/accessibility**
   - Settings pages fit at 960×600 and 1440×900; keyboard focus is visible;
     dialogs close with Escape and return focus.
   - The Code sidebar uses the blue DeepSeek web-chat whale in both the
     expanded brand and collapsed rail; it does not show the DSH fish mark.
   - The app bar shows only the DeepDeck wordmark; Chat and Code both show the
     same official whale in their upper-left page sidebar. The Settings/About
     headers and the installed app icon use the same official mark.
   - App-bar controls, the workspace chip, the status chip, and the palette
     all show visible focus rings; icon-only buttons have names.
   - Settings → General lists the keyboard shortcuts and they match behavior.
   - The injected folder+ composer button matches the composer's 34 px control
     size in both light and dark themes, has even spacing from the paperclip and
     send button, and shows a focus ring only for keyboard focus.
   - Resize from maximized to 960×600 while Chat is loaded. The chat page
     reflows to the new width instead of staying at the old layout and clipping
     on the right; the same check passes in Code.
   - Every entry in **Settings → General** selects and persists: System, Light,
     Dark, Midnight, Graphite, Paper. Arrow keys move the radio group. There is
     no theme button in the app bar. Custom dark themes keep chat and harness
     dark; Paper and Light keep both light.
   - Theme changes crossfade the shell, respect `prefers-reduced-motion`, and do
     not reload the real chat page when the embedded light/dark mode is
     unchanged (Dark → Midnight, for example). Settings section changes fade
     without clipping.
   - **Settings → API usage** embeds `https://platform.deepseek.com/usage` in a
     sandboxed, isolated view. The signed-out state shows the real Platform
     login; the phone/email form works in place, and after sign-in `/usage`
     renders above/below the selected section without clipping. The toolbar's
     Reload and Open in browser actions work; switching sections hides the view
     and does not leave it over General/Providers/etc.
   - The app bar has no theme, Activity, or API-usage buttons; the gear is the
     only entry to Settings, which contains theme, usage, account, providers,
     subagents, harness, updates, and about.
   - The account panel shows the current theme label and Settings without
     crowding at 384 px; it no longer duplicates the API usage link. Session
     reload/import states remain readable in all six themes.
   - Dialog focus does not land on the close X; the X is hidden during an
     import. Error cards, danger buttons, and the harness error dot are red,
     not white.
   - No clipped text in the provider rows, subagent model grid, or Harness
     status table.
   - In light mode, the app bar, Settings, and palette keep readable contrast
     (including `text-faint` hints and shortcut badges); switching back to dark
     updates both embedded pages.

## Evidence to keep

For a release, capture: chat signed in, Chat focus mode, Code with a running
session, the quick-actions palette, the app bar in light and dark, Providers
with configured keys, Subagents, and the quit/port-free state.
Screenshots are deliberately not committed because they can contain local paths,
account details, or conversation titles. Capture fresh images for a release and
review them before publishing.

## Local Deck series packaging pass

The copied working source now has an independent local Git checkout. The original development checkout was left untouched. The frontend/type checks, production build, and 87 tests passed. Source installers completed in disposable Fedora 44 and Debian 12 containers using Node 24.16.0, isolated data/configuration roots, and no working account profile.

Desktop command paths are quoted for installation directories containing spaces. This pass did not run fresh browser consent or paid provider requests. The container checks install the shell; first-launch coding runtime setup and graphical desktop behavior are separate checks.

## Installer and documentation review, 2026-11-06

Fresh source installation completed on Fedora 44 and Debian 12 using the documented Node version and isolated application/data paths. The new installer guard test confirms that help exits successfully and unknown arguments fail before building or installing. Frontend type checking, the production build, and all 88 shell tests passed. Socket-based tests ran with localhost access rather than the network-restricted sandbox. The shell installation does not by itself prove first-launch coding-runtime setup.

Source secret scans, shell syntax, and local Markdown links passed. These checks used disposable installations and fixtures. Fresh interactive sign-in, paid requests, and full graphical acceptance were not repeated; existing account profiles were left in place.

## 1.0 release verification

Fresh source installation, the regression suite, desktop-entry validation, and clean-profile launch completed on Fedora 44 and Debian 13. Tests ran as an unprivileged user with isolated application, configuration, launcher, and data paths. Launcher paths included spaces.

Virtual display captures used container-only sandbox and software-rendering options; these options were not added to production launchers. Fresh browser consent, paid requests, real account persistence, and complete graphical workflows were not exercised.

All 89 shell tests pass. Custom installation discovery and Node PATH precedence are covered. The newest managed harness, 0.2.2-rc.1, passed real isolated settings, credentials, provider, and subagent RPC checks without model requests. The standalone host page probe could not run without an X display; container captures verify shell startup separately.
