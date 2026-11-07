# Install DeepDeck

DeepDeck owns its coding runtime. A downloaded DeepSeek Harness checkout and
the official Harness desktop app are not prerequisites and are never modified.

## Prerequisites

- Node.js 24.9+ and npm. The installer can find an installed nvm Node when the
  system Node is older. Harness releases with higher requirements stay pending
  until a compatible Node is installed.
- A working Linux desktop and session bus. Chrome/Chromium is needed for Google
  sign-in; the site's email/password sign-in works inside DeepDeck.
- Network access to GitHub and npm for first-time coding setup and updates.
  An installed, verified coding runtime continues to work offline.

## Install and launch

Both Fedora and Debian use this installer. Install desktop libraries first:

```bash
# Fedora
sudo dnf install git nss gtk3 alsa-lib mesa-libgbm libsecret desktop-file-utils
# Debian 13
sudo apt install git libnss3 libgtk-3-0t64 libasound2t64 libgbm1 libsecret-1-0 desktop-file-utils
```

Install Node **24.9 or newer** and npm separately if your distribution ships an older version. The Debian package list above targets Debian 13.

```sh
cd /path/to/DeepDeck
bash packaging/install.sh
DeepDeck
DeepDeck --code
DeepDeck --chat
DeepDeck --settings
DeepDeck --dir /path/to/workspace
DeepDeck --stop
```

The default workspace is `~/Documents/DeepDeck`; set `DEEPDECK_WORKDIR` before
installing to choose another existing folder. The shell installs beneath
`$XDG_DATA_HOME/deepdeck` (normally `~/.local/share/deepdeck`), with a launcher in
`~/.local/bin`. Reinstallation preserves coding data and web sign-in.

Code's first launch installs an exact published `@deepseek-ai/dsh` release and
its package manager into a private version directory. There is no source build,
shared checkout update, global CLI install, or global pnpm prerequisite.
`--harness`, `DEEPDECK_HARNESS_REPO`, and source/built/pnpm launch modes no longer
select a runtime. `DEEPDECK_NODE` may select a compatible installed Node binary.

## Isolation and one-time import

Every coding process and package command receives private `DSH_HOME` and
`DSH_AGENTS_HOME` paths under DeepDeck's `harness/versions/` directory. Settings,
credentials, sessions, attachments, plugins, and caches belong to DeepDeck.
The official app's `profiles/desktop`, downloaded checkout, and processes are
not attached to, updated, rebuilt, or stopped.

On first setup, existing Web configuration, credentials, sessions, attachments,
and legacy DeepDeck presets are copied from the previously inherited
`DSH_HOME` (default `~/.dsh`). Regular global instructions and skills are also
copied into a private agents home; external skill symlinks are omitted. The
source is read-only. Locks, logs, caches, dependency trees, and the Desktop
profile are excluded. Imported secrets are owner-only files, never shell
preferences or logs. After promotion there is no synchronization with the
original home.

External local plugin references are refused instead of linking DeepDeck back
to another installation. Custom legacy presets are retained as supported private
bundle declarations. If a legacy preset cannot activate during first import,
Standard is selected and Updates displays a migration notice. Subagents can
compose a new DeepDeck Full preset from the current Standard composition;
original imported files remain preserved.

## Settings

- **Providers:** the live harness catalog, provider routes, credential state,
  model discovery, and default model. Writes use the host's validated API.
- **Subagents:** delegation model selection and host-managed optional backend
  bundles. Installing a backend does not start a native coding agent. Its tool
  becomes available through the enabled bundle; native product login remains
  authoritative.
- **Harness:** private runtime version, paths, process status, log, restart,
  reload, and a shortcut to native Plugins.
- **Updates:** installed/pending release, diagnostics, background checks, and
  next-launch installation. Manual Install/Retry stops Code while validating.
- **General:** workspace, port, theme, zoom, and shortcuts. Checkout and external
  launcher-patch controls have been removed.

Chat login and API credentials are separate. Google login opens ordinary Chrome,
then imports and verifies the chat session inside DeepDeck. The API usage page
has its own isolated platform login. `Ctrl+K` opens quick actions; `Ctrl+1` and
`Ctrl+2` switch modes. Chat attachments require explicit file selection.

## Updates and recovery

Background checks run after startup and every four hours. Published releases,
including prereleases, become pending; checks never restart an active session.
The default policy installs pending releases before Code starts on the next
launch. Turning that preference off leaves installation manual.

Each candidate gets its own package installation and data copy. DeepDeck checks
the real authenticated host APIs, selected plugins, preset activation, and an
actual Electron Code-page boot before switching the active pointer. Download,
installation, migration, boot, or compatibility failures retain the working
runtime and data. Interrupted or failed versions are not retried automatically;
use Retry or wait for a newer release. Chat remains available during setup.
Previous and failed private version directories are retained for recovery and
diagnostics; account for their disk usage when keeping many versions.

The desktop shell itself is updated by pulling the DeepDeck source and rerunning
`packaging/install.sh`. This never invokes the downloaded harness's updater.

## Troubleshooting

- **Node prerequisite:** install a compatible Node or set `DEEPDECK_NODE`, then
  retry. The selected binary is used for both launch and package operations.
- **First setup cannot reach npm/GitHub:** restore connectivity and use Updates →
  Retry. An existing verified runtime keeps working when release checks fail.
- **Plugin or preset diagnostics:** inspect Updates and the private harness log.
  No automatic compatibility exemption is granted. Modified generated presets
  block automatic regeneration instead of overwriting customizations.
- **Code cannot load:** use Harness → Open log, then Updates → Retry. Rebuilding
  your downloaded source checkout cannot repair DeepDeck's packaged runtime.

Removing DeepDeck's launcher and shell does not require removing its private
`harness/` data. Keep a backup before deleting that directory. Never delete
`~/.dsh` or the official application's files to uninstall DeepDeck.
