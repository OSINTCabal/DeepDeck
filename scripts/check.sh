#!/usr/bin/env bash
# Static checks and the main-process test suite. This does not start the app or
# touch the user's harness state.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Frontend typecheck"
( cd "$SRC/frontend" && npm run typecheck )
echo "==> Frontend build"
( cd "$SRC/frontend" && npm run build )
echo "==> Shell tests"
( cd "$SRC/shell/electron" && npm test )
echo "==> Done"
