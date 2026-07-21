#!/usr/bin/env bash
# Build, package, and install Khef Editor.app into /Applications so it's launchable
# via Spotlight / Cmd+Space. Quits any running instance first, then relaunches the
# freshly installed build.
#
# Usage:
#   npm run install:app             # fast: packages for THIS machine's architecture only
#   npm run install:app:universal   # universal (arm64 + x64); runs native on both, ~2x size/time
#
# Prefer the universal build when the resulting .app will be copied to another Mac of a
# different architecture — a single-arch app copied across arches runs under Rosetta (slow)
# or not at all. Note: building under a Rosetta terminal makes electron-builder infer x64;
# the universal target sidesteps that by producing both slices regardless of the shell arch.
#
# The app is unsigned (electron-builder runs with identity=null), so this also clears
# the quarantine flag on the installed bundle to avoid a Gatekeeper prompt.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# --universal → build both arch slices into one bundle (dist-app/mac-universal/).
UNIVERSAL=0
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    *) echo "khef-editor: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

APP_NAME="Khef Editor.app"
DEST="/Applications/${APP_NAME}"

echo "khef-editor: quitting any running instance…"
osascript -e 'tell application "Khef Editor" to quit' >/dev/null 2>&1 || true
pkill -f "Khef Editor" >/dev/null 2>&1 || true
sleep 1

if [[ "$UNIVERSAL" -eq 1 ]]; then
  echo "khef-editor: packaging universal app (arm64 + x64)…"
  npm run package:universal
else
  echo "khef-editor: packaging app…"
  npm run package
fi

# electron-builder emits: mac-universal/ (--universal), mac-arm64/ (Apple Silicon), mac/ (Intel).
# dist-app/ is not cleared between runs, so a stale dir from an earlier build can coexist with
# this run's output. Search in an order that matches THIS run so we never install a stale slice:
# universal-first when --universal, single-arch-first otherwise.
if [[ "$UNIVERSAL" -eq 1 ]]; then
  SEARCH=("dist-app/mac-universal/${APP_NAME}")
else
  SEARCH=("dist-app/mac-arm64/${APP_NAME}" "dist-app/mac/${APP_NAME}" "dist-app/mac-universal/${APP_NAME}")
fi
SRC=""
for dir in "${SEARCH[@]}"; do
  if [[ -d "$dir" ]]; then SRC="$dir"; break; fi
done
if [[ -z "$SRC" ]]; then
  echo "khef-editor: could not find a packaged app under dist-app/." >&2
  exit 1
fi

echo "khef-editor: installing ${SRC} → ${DEST}"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

# Clear quarantine on the unsigned bundle so Gatekeeper doesn't block first launch.
xattr -dr com.apple.quarantine "$DEST" >/dev/null 2>&1 || true

# Register with Launch Services so Spotlight / Cmd+Space finds it immediately.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$DEST" || true
fi

echo "khef-editor: launching…"
open -a "Khef Editor"

echo "khef-editor: installed to ${DEST}"
