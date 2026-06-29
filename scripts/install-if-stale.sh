#!/usr/bin/env bash
# Build and install Khef Editor.app into ~/Applications only when source inputs have
# changed since the last install. Mirrors apps/voice/scripts/install-if-stale.sh.
#
# Invoked by khef's `npm run refresh` via an existence-guarded step (skip-if-absent,
# fail-if-broken — see design-doc-khef-editor §5.2). Pass --force to reinstall
# unconditionally.
#
# NOTE: stub for the scaffold story. The DMG/.app packaging + hash-gated install is
# implemented in story-polish-and-package. Today this just builds the renderer so the
# refresh hook has something real to call.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
fi

echo "khef-editor: installing dependencies (if needed)…"
npm install --no-audit --no-fund

echo "khef-editor: building renderer…"
npm run build

echo "khef-editor: build complete. (App packaging/install lands in story-polish-and-package; force=${force}.)"
