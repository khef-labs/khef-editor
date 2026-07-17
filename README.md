# Khef Editor

A standalone, lightweight code editor — VS Code-lite without plugins, marketplace, or an extension host. Built on Electron + Preact + Vite + CodeMirror 6.

This is a **net-new, fully independent app**. It shares no code with [khef](../khef) and imports nothing from it. khef's editor is used only as design reference. See the tech design in khef memory `design-doc-khef-editor` (project `khef-editor`).

## Status

Working editor: file tree, Cmd+P fuzzy finder, tabbed CodeMirror editing with syntax highlighting, color themes + settings, Emacs-style split panes (C-x 3/2/1/0), and project-wide search with search-and-replace. The git source-control panel and polish (app icon, recent folders, persisted layout) are the remaining stories.

## Architecture

- **`electron/main.cjs`** — main process. Owns the window and all filesystem access. Renderer is hardened: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, strict CSP, navigation guards.
- **`electron/workspace.cjs`** — path confinement. Every fs op is confined to the open workspace root, checked on `fs.realpath` (with the nearest-existing-ancestor rule for new files) and `path.relative` containment. This is the core security seam.
- **`electron/fs-ipc.cjs`** — IPC fs handlers (open workspace, read, write, tree, delete), size-capped and ignore-set-aware.
- **`electron/preload.cjs`** — exposes a minimal typed `window.editorApi`. Never exposes `ipcRenderer`/`fs`/`child_process`.
- **`electron/types.d.ts`** — the `editorApi` contract, shared with the renderer.
- **`src/renderer/`** — Preact UI (empty editor shell for now).

## Install

Fresh clone on a new machine — requires **Node ≥ 22** and **npm ≥ 10** (enforced by `engines`; check with `node -v`).

```bash
cd khef-editor
npm install
npm run dev          # Vite dev server + Electron with HMR
```

That's the whole dev loop. No `.env`, no database, no khef dependency — fully standalone.

```bash
npm run typecheck    # tsc --noEmit (optional sanity check)
npm run build        # build renderer to dist/
```

## Shell helper

Install the `ke` alias:

```bash
npm run ke:install
```

Then use it like:

```bash
ke                  # open the current directory in a new Khef Editor window
ke .                # open this directory in a new window
ke src/App.tsx      # open a file in the focused window
ke src/App.tsx:42   # open a file and jump to line 42
```

The canonical helper is `scripts/ke-edit.sh`; `scripts/ke` is a compatibility wrapper.

## Build the Mac app (Spotlight / Cmd+Space launchable)

One command builds, installs to `/Applications`, and launches it:

```bash
npm run install:app
```

It quits any running instance, packages the app, copies it to `/Applications`,
clears the quarantine flag, registers it with Launch Services (so Spotlight finds
it), and relaunches. Works on Apple Silicon (`mac-arm64`) and Intel (`mac`).

To do it by hand instead:

```bash
npm run package      # builds renderer + unsigned .app into dist-app/mac-arm64/
rm -rf "/Applications/Khef Editor.app"
cp -R "dist-app/mac-arm64/Khef Editor.app" /Applications/
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Khef Editor.app"
```

Use `npm run dist` to produce a DMG instead of a raw `.app`.

**Notes**

- The app is **unsigned** (no notarization). On a different Mac, Gatekeeper blocks first launch — right-click → Open, or clear the quarantine flag:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Khef Editor.app"
  ```
- Output path assumes **Apple Silicon** (`mac-arm64`). On Intel, electron-builder emits `mac` (x64) — adjust the paths above accordingly.

## Security

See `ctx-security-pre-analysis` (khef memory, project `khef-editor`) for the full threat model. Key invariants enforced in the scaffold:

- Renderer cannot touch Node/`fs`/`child_process` directly.
- All fs paths are confined to the open workspace root, verified on realpath — symlinks cannot escape.
- Strict CSP: no remote script, no eval (prod).
