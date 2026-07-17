#!/usr/bin/env bash
# ke-edit - open a file or directory in the native Khef Editor app
#
# Usage:
#   ke <path>          Open file or directory
#   ke <file>:<line>   Open file at line number
#   ke                 Open editor at current directory
#   ke --install       Add ke alias to shell profile

set -euo pipefail

APP_NAME="${KE_APP_NAME:-Khef Editor}"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

if [[ "${1:-}" == "--install" ]]; then
  profile="$HOME/.bash_profile"
  [[ "$(basename "${SHELL:-bash}")" == "zsh" ]] && profile="$HOME/.zshrc"

  alias_line="alias ke='${SCRIPT_PATH}'"

  if grep -qF "$SCRIPT_PATH" "$profile" 2>/dev/null; then
    echo "ke: alias already installed in $profile"
    exit 0
  fi

  if grep -qF "alias ke=" "$profile" 2>/dev/null; then
    existing="$(grep "alias ke=" "$profile")"
    echo "WARNING: existing ke alias found in $profile:"
    echo "  $existing"
    echo "Replacing with: $alias_line"
    sed -i '' "s|^alias ke=.*|${alias_line}|" "$profile"
    echo "ke: alias updated in $profile"
    exit 0
  fi

  if command -v ke &>/dev/null; then
    echo "WARNING: 'ke' already exists as a command: $(command -v ke)"
    echo "Skipping alias install. To override, manually add to $profile:"
    echo "  $alias_line"
    exit 0
  fi

  echo "" >> "$profile"
  echo "# Khef Editor - open files/dirs in the native app" >> "$profile"
  echo "$alias_line" >> "$profile"
  echo "ke: alias added to $profile (restart terminal or: source $profile)"
  exit 0
fi

arg="${1:-}"

encode() { python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }

open_target() {
  local target="$1"
  local line_no="${2:-}"
  local new_window="${3:-}"
  local url="khef-editor://open?path=$(encode "$target")"
  [[ -n "$line_no" ]] && url+="&line=${line_no}"
  [[ "$new_window" == "1" ]] && url+="&newWindow=1"

  # A custom protocol is the reliable path when the app is already running. If the
  # installed app has not registered it yet, fall back to app args for cold-launch use.
  if open "$url" 2>/dev/null; then
    return 0
  fi

  if [[ -n "$line_no" ]]; then
    if [[ "$new_window" == "1" ]]; then
      open -n -a "$APP_NAME" --args --new-window --goto "${target}:${line_no}"
    else
      open -a "$APP_NAME" --args --goto "${target}:${line_no}"
    fi
  else
    if [[ "$new_window" == "1" ]]; then
      open -n -a "$APP_NAME" --args --new-window "$target"
    else
      open -a "$APP_NAME" --args "$target"
    fi
  fi
}

if [[ -z "$arg" ]]; then
  open_target "$(pwd)" "" "1"
  exit 0
fi

line=""
if [[ "$arg" =~ ^(.+):([0-9]+)$ ]]; then
  arg="${BASH_REMATCH[1]}"
  line="${BASH_REMATCH[2]}"
fi

resolved="$(cd "$(dirname "$arg")" 2>/dev/null && pwd)/$(basename "$arg")"
if [[ ! -e "$resolved" ]]; then
  echo "ke: $arg: No such file or directory" >&2
  exit 1
fi

if [[ -d "$resolved" ]]; then
  open_target "$resolved" "" "1"
elif [[ -f "$resolved" ]]; then
  open_target "$resolved" "$line"
else
  echo "ke: $arg: Not a file or directory" >&2
  exit 1
fi
