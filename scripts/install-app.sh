#!/usr/bin/env bash
# Build, package, and install Khef Editor.app into /Applications so it's launchable
# via Spotlight / Cmd+Space. Quits any running instance first, then relaunches the
# freshly installed build.
#
# Usage: npm run install:app
#
# The app is unsigned (electron-builder runs with identity=null), so this also clears
# the quarantine flag on the installed bundle to avoid a Gatekeeper prompt.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="Khef Editor.app"
DEST="/Applications/${APP_NAME}"

echo "khef-editor: quitting any running instance…"
osascript -e 'tell application "Khef Editor" to quit' >/dev/null 2>&1 || true
pkill -f "Khef Editor" >/dev/null 2>&1 || true
sleep 1

echo "khef-editor: packaging app…"
npm run package

# electron-builder emits mac-arm64/ on Apple Silicon and mac/ on Intel.
SRC=""
for dir in "dist-app/mac-arm64/${APP_NAME}" "dist-app/mac/${APP_NAME}"; do
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
