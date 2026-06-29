# Khef Editor

A standalone, lightweight code editor — VS Code-lite without plugins, marketplace, or an extension host. Built on Electron + Preact + Vite (CodeMirror lands in the next phase).

This is a **net-new, fully independent app**. It shares no code with [khef](../khef) and imports nothing from it. khef's editor is used only as design reference. See the tech design in khef memory `design-doc-khef-editor` (project `khef-editor`).

## Status

Scaffold phase complete: hardened Electron shell + typed IPC filesystem surface with workspace-root confinement. Editor core (file tree, fuzzy finder, CodeMirror, tabs/splits), search, and git are subsequent stories.

## Architecture

- **`electron/main.cjs`** — main process. Owns the window and all filesystem access. Renderer is hardened: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, strict CSP, navigation guards.
- **`electron/workspace.cjs`** — path confinement. Every fs op is confined to the open workspace root, checked on `fs.realpath` (with the nearest-existing-ancestor rule for new files) and `path.relative` containment. This is the core security seam.
- **`electron/fs-ipc.cjs`** — IPC fs handlers (open workspace, read, write, tree, delete), size-capped and ignore-set-aware.
- **`electron/preload.cjs`** — exposes a minimal typed `window.editorApi`. Never exposes `ipcRenderer`/`fs`/`child_process`.
- **`electron/types.d.ts`** — the `editorApi` contract, shared with the renderer.
- **`src/renderer/`** — Preact UI (empty editor shell for now).

## Develop

```bash
npm install
npm run dev        # Vite dev server + Electron with HMR
npm run typecheck  # tsc --noEmit
npm run build      # build renderer to dist/
npm run package    # unsigned .app into dist-app/ (no DMG)
```

## Security

See `ctx-security-pre-analysis` (khef memory, project `khef-editor`) for the full threat model. Key invariants enforced in the scaffold:

- Renderer cannot touch Node/`fs`/`child_process` directly.
- All fs paths are confined to the open workspace root, verified on realpath — symlinks cannot escape.
- Strict CSP: no remote script, no eval (prod).
