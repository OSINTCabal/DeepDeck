#!/usr/bin/env bash
# DeepDeck user-level install (no root). Builds the shell SPA, installs the
# Electron runtime, and adds a launcher, desktop entry, and icons. User data
# under ~/.config/deepdeck and ~/.local/share/deepdeck is preserved.
set -euo pipefail
case "${1:-}" in --help|-h) echo 'Usage: bash packaging/install.sh'; exit 0;; '') [ "$#" -eq 0 ] || exit 2;; *) echo 'Unknown option. Use --help.' >&2; exit 2;; esac

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
APP="${DEEPDECK_INSTALL_HOME:-$DATA_HOME/deepdeck}"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS="$DATA_HOME/applications"
ICONS="$DATA_HOME/icons/hicolor"
CFG="$CONFIG_HOME/deepdeck"

if [ "$SRC" = "$APP" ]; then
  echo "Install from the source checkout, not the installed app." >&2
  exit 1
fi

echo "==> Checking prerequisites"
for tool in node npm; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See docs/INSTALL.md." >&2; exit 1; }
done
# Desktop launchers may start with an older system Node on PATH.
if ! node -e 'const [m,n]=process.versions.node.split(".").map(Number); process.exit(m>24||(m===24&&n>=9)?0:1)'; then
  NODE_DIR="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$NODE_DIR" ] && export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
fi
node -e 'const [m,n]=process.versions.node.split(".").map(Number); if(m<24||(m===24&&n<9)) throw Error("Node 24.9+ required")'
if [ -n "${DEEPDECK_WORKDIR:-}" ]; then
  WORKDIR="$DEEPDECK_WORKDIR"
  [ -d "$WORKDIR" ] || { echo "The configured workspace was not found at $WORKDIR." >&2; exit 1; }
else
  WORKDIR="$HOME/Documents/DeepDeck"
  mkdir -p "$WORKDIR"
fi
if ! command -v google-chrome >/dev/null 2>&1 && ! command -v google-chrome-stable >/dev/null 2>&1 \
  && ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  echo "Note: Chrome/Chromium was not found. In-app DeepSeek sign-in still works; the Chrome fallback will be unavailable."
fi

echo "==> Building the shell frontend"
( cd "$SRC/frontend" && npm ci --no-audit --no-fund && npm run build )

echo "==> Preparing the Electron runtime"
( cd "$SRC/shell/electron" && npm ci --no-audit --no-fund )
if [ ! -x "$SRC/shell/electron/node_modules/electron/dist/electron" ]; then
  ( cd "$SRC/shell/electron" && node node_modules/electron/install.js )
fi
test -x "$SRC/shell/electron/node_modules/electron/dist/electron" || {
  echo "Electron did not install correctly." >&2
  exit 1
}

echo "==> Installing to $APP"
mkdir -p "$APP" "$BIN" "$APPS" "$ICONS" "$CFG"
STAGE="$(mktemp -d "$APP/.install-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/frontend" "$STAGE/shell"
cp -a "$SRC/frontend/dist" "$STAGE/frontend/dist"
cp -a "$SRC/shell/electron" "$STAGE/shell/electron"
cp -a "$SRC/packaging" "$STAGE/packaging"
cp -a "$SRC/README.md" "$STAGE/README.md"
cp -a "$SRC/LICENSE" "$STAGE/LICENSE"
cp -a "$SRC/NOTICE" "$STAGE/NOTICE" 2>/dev/null || true
cp -a "$SRC/CONTRIBUTING.md" "$STAGE/CONTRIBUTING.md" 2>/dev/null || true
cp -a "$SRC/SECURITY.md" "$STAGE/SECURITY.md" 2>/dev/null || true
cp -a "$SRC/CODE_OF_CONDUCT.md" "$STAGE/CODE_OF_CONDUCT.md" 2>/dev/null || true
cp -a "$SRC/docs" "$STAGE/docs"
chmod 0644 "$STAGE/README.md" "$STAGE/LICENSE" 2>/dev/null || true
PARTS=(frontend shell packaging README.md LICENSE docs)
for optional in NOTICE CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md; do
  [ -e "$STAGE/$optional" ] && PARTS+=("$optional")
done
for part in "${PARTS[@]}"; do
  rm -rf "$APP/$part"
  mv "$STAGE/$part" "$APP/$part"
done

echo "==> Installing the launcher, desktop entry, and icons"
chmod 0755 "$APP/packaging/bin/DeepDeck"
ln -sfnT "$APP/packaging/bin/DeepDeck" "$BIN/DeepDeck"
ln -sfn "$BIN/DeepDeck" "$BIN/deepdeck"
node - "$SRC/packaging/deepdeck.desktop" "$APPS/deepdeck.desktop" "$BIN/DeepDeck" <<'JS'
const fs=require('fs');fs.writeFileSync(process.argv[3],fs.readFileSync(process.argv[2],'utf8').replace(/^Exec=.*$/m,()=> 'Exec='+JSON.stringify(process.argv[4])+' %U'));
JS
chmod 0644 "$APPS/deepdeck.desktop"
for size in 16 32 48 128 256 512; do
  mkdir -p "$ICONS/${size}x${size}/apps"
  if [ -f "$SRC/packaging/deepdeck-icon-$size.png" ]; then
    install -m 0644 "$SRC/packaging/deepdeck-icon-$size.png" "$ICONS/${size}x${size}/apps/deepdeck.png"
  fi
done
mkdir -p "$ICONS/scalable/apps"
install -m 0644 "$SRC/packaging/deepdeck-icon.svg" "$ICONS/scalable/apps/deepdeck.svg"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$ICONS" >/dev/null 2>&1 || true

if [ ! -f "$CFG/env" ]; then
  cat > "$CFG/env" <<EOF
# DeepDeck launcher environment. Sourced by ~/.local/bin/DeepDeck. 0600.
# API keys do NOT belong here; the harness credential store owns them.
export DEEPDECK_WORKDIR=$(printf '%q' "$WORKDIR")
# export DEEPDECK_ELECTRON="/path/to/electron"
EOF
  chmod 0600 "$CFG/env"
fi

cat <<EOF

DeepDeck is installed.

  Launch:        DeepDeck
  Or:            $BIN/DeepDeck
  App menu:      DeepDeck
  Workspace:     $WORKDIR
  Coding data:   $APP/harness (private)
  Settings:      $CFG/env (launcher paths only)

First launch opens the welcome sheet. Chat mode loads the real
chat.deepseek.com and can sign in with Google (with a Chrome fallback).
Code installs its own released dsh package and uses a private data home.
Existing Web settings and sessions are imported once by read-only copy.
Your downloaded harness and the official desktop app are never updated or stopped.

To update: pull the source, then run packaging/install.sh again.
EOF
