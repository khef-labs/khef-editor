import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { Files, Search as SearchIcon, GitBranch, Settings } from 'lucide-preact'
import type { FsTreeEntry, FileListEntry } from '../../electron/types'
import { FileTree } from './components/FileTree'
import { QuickOpen } from './components/QuickOpen'
import { SettingsPanel } from './components/SettingsPanel'
import { SearchPanel } from './components/SearchPanel'
import { PaneTree } from './components/PaneTree'
import { OpenEditors } from './components/OpenEditors'
import { SourceControlPanel } from './components/SourceControlPanel'
import { ContextMenu, type MenuEntry } from './components/ContextMenu'
import { selectAllInActiveEditor, setSelectionStatusListener } from './components/CodeEditor'
import { themeById, applyTheme } from './lib/themes'
import { isPreviewable } from './lib/preview'
import {
  makeLeaf, leaves, findLeaf, updateLeaf, mapLeaves, splitLeaf, splitLeafWithTab, removeLeaf, soloLeaf, setSplitSizes,
  type LayoutNode, type OpenTab,
} from './lib/layout'

export function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string>('')
  const [entries, setEntries] = useState<FsTreeEntry[]>([])
  const [tree, setTree] = useState<LayoutNode>(() => makeLeaf())
  const [activeLeafId, setActiveLeafId] = useState<string>(() => '')
  const [error, setError] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<'explorer' | 'search' | 'scm'>('explorer')
  const [scmRefresh, setScmRefresh] = useState(0)
  const [recentFolders, setRecentFolders] = useState<string[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number; token: number } | null>(null)
  const jumpTokenRef = useRef(0)
  const [themeId, setThemeId] = useState<string>('dark-plus')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Status-bar selection label ("3 selections" / "12 selected"), fed by the active editor.
  const [selStatus, setSelStatus] = useState('')
  // Tab context menu (right-click a tab): which tab, and where to render the menu.
  const [tabMenu, setTabMenu] = useState<{ leafId: string; path: string; x: number; y: number } | null>(null)

  useEffect(() => {
    setSelectionStatusListener(setSelStatus)
    return () => setSelectionStatusListener(null)
  }, [])

  // Focus the initial leaf on mount.
  useEffect(() => {
    setActiveLeafId(leaves(tree)[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load persisted settings + apply theme.
  useEffect(() => {
    window.editorApi.getSettings().then((s) => {
      const t = themeById(s.theme)
      setThemeId(t.id)
      applyTheme(t)
      if (typeof s.sidebarWidth === 'number' && s.sidebarWidth > 0) {
        setSidebarWidth(Math.max(180, Math.min(s.sidebarWidth, 700)))
      }
    }).catch(() => { applyTheme(themeById('dark-plus')) })
    void window.editorApi.recentFolders().then(setRecentFolders)
  }, [])

  // Sidebar resize drag. Dragging clamps width to [MIN_W, MAX_W] and NEVER fully closes the
  // sidebar (a click on the border used to collapse it — that was the bug). Full close is
  // Cmd+B only. A sub-threshold move is treated as a click and does nothing.
  const MIN_W = 170
  const MAX_W = 700
  const DRAG_THRESHOLD = 4 // px of movement before a click counts as a drag
  const startSidebarDrag = useCallback((e: PointerEvent) => {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    // When collapsed, dragging the (0-width) border re-opens the sidebar from MIN_W.
    const startW = sidebarCollapsed ? MIN_W : sidebarWidth
    let width = startW
    let dragging = false
    const onMove = (ev: PointerEvent) => {
      // Ignore sub-threshold movement so a plain click on the border does nothing (it used
      // to collapse the sidebar). Dragging NEVER fully closes it — width is clamped to
      // [MIN_W, MAX_W]; full close is Cmd+B only (VS Code behavior).
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return
        dragging = true
        handle.classList.add('dragging')
        if (sidebarCollapsed) setSidebarCollapsed(false) // a real drag re-opens a closed sidebar
      }
      const raw = startW + (ev.clientX - startX)
      width = Math.max(MIN_W, Math.min(MAX_W, raw))
      setSidebarWidth(width)
    }
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId)
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      // Persist only if an actual drag happened (a bare click leaves state untouched).
      if (dragging) void window.editorApi.setSettings({ sidebarWidth: Math.round(width) })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }, [sidebarWidth, sidebarCollapsed])

  // Clicking an activity-bar view icon: open that view, or toggle collapse if it's the
  // already-active view (VS Code behavior).
  const selectView = useCallback((view: 'explorer' | 'search' | 'scm') => {
    setSettingsOpen(false)
    if (!sidebarCollapsed && sidebarView === view) {
      setSidebarCollapsed(true)
    } else {
      setSidebarCollapsed(false)
      setSidebarView(view)
      if (view === 'scm') setScmRefresh((n) => n + 1) // refresh git state on open
    }
  }, [sidebarCollapsed, sidebarView])

  // Cmd+B: toggle the sidebar open/closed (VS Code behavior).
  const toggleSidebar = useCallback(() => {
    setSettingsOpen(false)
    setSidebarCollapsed((v) => !v)
  }, [])

  const selectTheme = useCallback((id: string) => {
    const t = themeById(id)
    setThemeId(t.id)
    applyTheme(t)
    void window.editorApi.setSettings({ theme: t.id })
  }, [])

  // Open a folder. With no path, shows the picker; with a path (recent folder), opens it.
  const openFolder = useCallback(async (dirPath?: string) => {
    setError(null)
    try {
      const res = await window.editorApi.openWorkspace(dirPath ?? null)
      if (!res) return
      setRoot(res.root)
      setRootName(res.root.split('/').filter(Boolean).pop() ?? res.root)
      const t = await window.editorApi.tree(res.root, 1)
      setEntries(t.entries)
      // Reveal the Explorer when a folder opens (sidebar starts collapsed).
      setSidebarView('explorer')
      setSidebarCollapsed(false)
      void window.editorApi.recentFolders().then(setRecentFolders)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Open a file into the focused leaf (or activate it there if already open). When
  // `preloaded` is given (loose file already read in main), skip the confined read.
  //
  // `ephemeral` requests VS Code "preview tab" behavior: the file soft-opens in an
  // ephemeral tab, and a subsequent ephemeral open in the same leaf REPLACES it in place
  // (at most one ephemeral tab per leaf) instead of adding a tab.
  //
  // Async-safety: the target leaf is captured from a ref (focus can move while a read is in
  // flight), and each open bumps a per-leaf request token. After the async read, the
  // functional setTree aborts if a newer open for that leaf has superseded this one — so
  // rapid single-clicks and click→double-click races can't let a stale read clobber the tab.
  const openPath = useCallback(async (
    filePath: string,
    name: string,
    preloaded?: { content: string; loose?: boolean },
    opts?: { ephemeral?: boolean },
  ) => {
    setError(null)
    const leafId = activeLeafIdRef.current
    const ephemeral = !!opts?.ephemeral
    const token = (openTokens.current.get(leafId) ?? 0) + 1
    openTokens.current.set(leafId, token)

    const leaf = findLeaf(treeRef.current, leafId)
    const already = leaf?.tabs.find((t) => t.path === filePath)
    if (already) {
      // Already open in this leaf → just activate. A permanent tab is NOT demoted to
      // ephemeral; an existing ephemeral tab for this exact file stays as-is.
      setTree((prev) => updateLeaf(prev, leafId, (l) => ({ ...l, activePath: filePath })))
      return
    }
    let content: string
    if (preloaded) {
      content = preloaded.content
    } else {
      try {
        const res = await window.editorApi.readFile(filePath)
        content = res.content
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
    setTree((prev) => {
      // Superseded by a newer open for this leaf while the read was in flight → drop.
      if (openTokens.current.get(leafId) !== token) return prev
      return updateLeaf(prev, leafId, (l) => {
        // Re-check inside the latest state: if the file is now open, just activate it.
        if (l.tabs.some((t) => t.path === filePath)) {
          return { ...l, activePath: filePath }
        }
        const tab: OpenTab = { path: filePath, name, content, savedContent: content, loose: preloaded?.loose, ephemeral: ephemeral || undefined }
        if (ephemeral) {
          // Replace an existing ephemeral (plain editor) tab in place, preserving position.
          const idx = l.tabs.findIndex((t) => t.ephemeral && (t.kind === undefined || t.kind === 'editor'))
          if (idx >= 0) {
            const tabs = [...l.tabs]
            tabs[idx] = tab
            return { ...l, tabs, activePath: filePath }
          }
        }
        return { ...l, tabs: [...l.tabs, tab], activePath: filePath }
      })
    })
  }, [])

  // Explorer single-click → soft-open (ephemeral). Double-click promotes (see openFilePermanent).
  const openFile = useCallback((entry: FsTreeEntry) => {
    if (entry.type !== 'file') return
    void openPath(entry.path, entry.name, undefined, { ephemeral: true })
  }, [openPath])

  // Explorer double-click → open permanently (never ephemeral). If the file is already the
  // ephemeral tab, promote it in place.
  const openFilePermanent = useCallback((entry: FsTreeEntry) => {
    if (entry.type !== 'file') return
    const leafId = activeLeafIdRef.current
    // Bump the token so any in-flight ephemeral read for this leaf is invalidated.
    openTokens.current.set(leafId, (openTokens.current.get(leafId) ?? 0) + 1)
    const leaf = findLeaf(treeRef.current, leafId)
    if (leaf?.tabs.some((t) => t.path === entry.path)) {
      // Already open → promote to permanent + activate.
      setTree((prev) => updateLeaf(prev, leafId, (l) => ({
        ...l,
        tabs: l.tabs.map((t) => (t.path === entry.path ? { ...t, ephemeral: undefined } : t)),
        activePath: entry.path,
      })))
      return
    }
    void openPath(entry.path, entry.name)
  }, [openPath])

  // Promote a tab to permanent (double-click the tab). No-op for preview/diff tabs.
  const promoteTab = useCallback((leafId: string, path: string) => {
    setTree((prev) => updateLeaf(prev, leafId, (l) => ({
      ...l,
      tabs: l.tabs.map((t) => (t.path === path && (t.kind === undefined || t.kind === 'editor') ? { ...t, ephemeral: undefined } : t)),
    })))
  }, [])

  // Cmd+N — a new empty Untitled-N buffer in the focused leaf. Editable immediately; first
  // Save opens a native Save dialog (see saveTab) and the tab adopts the chosen path.
  const newUntitled = useCallback(() => {
    const leafId = activeLeafIdRef.current
    const n = ++untitledSeq.current
    const tab: OpenTab = {
      path: `untitled:${n}`,
      name: `Untitled-${n}`,
      content: '',
      savedContent: '',
      untitled: true,
    }
    setTree((prev) => updateLeaf(prev, leafId, (l) => ({ ...l, tabs: [...l.tabs, tab], activePath: tab.path })))
  }, [])

  // Open a single file via native dialog as a loose tab — does NOT change the workspace
  // root or the tree. The file is read in main (it may live outside any root) and opens
  // as a detached tab that saves back through the per-file loose-write gate.
  const openFileViaDialog = useCallback(async () => {
    setError(null)
    try {
      const res = await window.editorApi.openLooseFile()
      if (!res) return
      const name = res.path.split('/').pop() ?? res.path
      await openPath(res.path, name, { content: res.content, loose: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [openPath])

  const pickQuickOpen = useCallback((entry: FileListEntry) => {
    setQuickOpen(false)
    void openPath(entry.path, entry.name)
  }, [openPath])

  // Open a read-only git diff as a tab in the focused leaf (or focus it if already open).
  const openDiff = useCallback((spec: { mode: 'working' | 'commit'; file: string; hash?: string }, title: string) => {
    const diffPath = `diff://${spec.mode}/${spec.hash ?? 'wt'}/${spec.file}`
    const leafId = activeLeafIdRef.current
    const leaf = findLeaf(treeRef.current, leafId)
    if (leaf?.tabs.some((t) => t.path === diffPath)) {
      setTree((prev) => updateLeaf(prev, leafId, (l) => ({ ...l, activePath: diffPath })))
      return
    }
    setTree((prev) => updateLeaf(prev, leafId, (l) => {
      const tab: OpenTab = { path: diffPath, name: title, content: '', savedContent: '', kind: 'diff', diff: spec }
      return { ...l, tabs: [...l.tabs, tab], activePath: diffPath }
    }))
  }, [])

  const openMatch = useCallback((filePath: string, fileName: string, line: number) => {
    void openPath(filePath, fileName).then(() => {
      jumpTokenRef.current += 1
      setPendingJump({ path: filePath, line, token: jumpTokenRef.current })
    })
  }, [openPath])

  const activateTab = useCallback((leafId: string, path: string) => {
    setActiveLeafId(leafId)
    setTree((prev) => updateLeaf(prev, leafId, (l) => ({ ...l, activePath: path })))
  }, [])

  const changeContent = useCallback((_leafId: string, path: string, content: string) => {
    // Update the tab in EVERY leaf showing this file, not just the one being typed in —
    // split views of the same file must stay in sync (save and revert already map across
    // all leaves; Split Right from the tab menu makes same-file splits routine).
    setTree((prev) => mapLeaves(prev, (l) => ({
      ...l, tabs: l.tabs.map((t) => (t.path === path ? { ...t, content } : t)),
    })))
    // Live-update any preview tab sourced from this file, across all panes. Keep
    // savedContent in sync so a preview never renders as dirty.
    setTree((prev) => mapLeaves(prev, (l) => ({
      ...l, tabs: l.tabs.map((t) => (t.kind === 'preview' && t.sourcePath === path ? { ...t, content, savedContent: content } : t)),
    })))
  }, [])

  // A genuine USER edit in a tab promotes it from ephemeral (preview) to permanent, like
  // VS Code. Fired via CodeEditor's onUserEdit — NOT on programmatic doc replacement, so
  // swapping the previewed file doesn't self-promote. Also bump the leaf's open token so an
  // in-flight ephemeral read can't re-mark this now-permanent tab.
  const editTab = useCallback((leafId: string, path: string) => {
    openTokens.current.set(leafId, (openTokens.current.get(leafId) ?? 0) + 1)
    setTree((prev) => updateLeaf(prev, leafId, (l) => {
      const tab = l.tabs.find((t) => t.path === path)
      if (!tab || !tab.ephemeral) return l
      return { ...l, tabs: l.tabs.map((t) => (t.path === path ? { ...t, ephemeral: undefined } : t)) }
    }))
  }, [])

  const saveTab = useCallback(async (leafId: string, path: string) => {
    const leaf = findLeaf(treeRef.current, leafId)
    const tab = leaf?.tabs.find((t) => t.path === path)
    if (!tab) return
    if (tab.kind === 'preview' || tab.kind === 'diff') return // read-only tabs

    // Untitled buffer → Save-As. Main owns the dialog + the confined/loose write decision;
    // the renderer never supplies the final path.
    if (tab.untitled) {
      const writtenContent = tab.content // exactly what we send to disk
      try {
        const res = await window.editorApi.saveAs(writtenContent, tab.name)
        if (!res) return // user canceled → stays untitled
        setTree((prev) => {
          // Re-find the untitled tab by its synthetic path; it may have been closed.
          const target = findLeaf(prev, leafId)?.tabs.find((t) => t.path === path)
          if (!target) return prev
          // If the chosen path is ALREADY open in this leaf, merge: drop the untitled tab
          // and activate the existing one (avoid two tabs sharing one path identity).
          const dup = findLeaf(prev, leafId)?.tabs.find((t) => t.path === res.path && t.path !== path)
          if (dup) {
            let next = updateLeaf(prev, leafId, (l) => ({
              ...l, tabs: l.tabs.filter((t) => t.path !== path), activePath: res.path,
            }))
            // Update the existing tab's content everywhere to the just-written content.
            next = mapLeaves(next, (l) => ({
              ...l, tabs: l.tabs.map((t) => (t.path === res.path ? { ...t, content: writtenContent, savedContent: writtenContent } : t)),
            }))
            return next
          }
          // Adopt the real path in place. If the user typed during the dialog, keep their
          // current content and leave the tab dirty (savedContent = what was written).
          return updateLeaf(prev, leafId, (l) => ({
            ...l,
            tabs: l.tabs.map((t) => (t.path === path
              ? { ...t, path: res.path, name: res.name, untitled: undefined, loose: res.loose || undefined, savedContent: writtenContent }
              : t)),
            activePath: l.activePath === path ? res.path : l.activePath,
          }))
        })
        setScmRefresh((n) => n + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      return
    }

    try {
      if (tab.loose) {
        await window.editorApi.writeLooseFile(tab.path, tab.content)
      } else {
        await window.editorApi.writeFile(tab.path, tab.content)
      }
      // Mark saved in EVERY leaf showing this file (split views stay in sync).
      setTree((prev) => mapLeaves(prev, (l) => ({
        ...l, tabs: l.tabs.map((t) => (t.path === path ? { ...t, savedContent: t.content } : t)),
      })))
      setScmRefresh((n) => n + 1) // working-tree changed → refresh source control
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Close a tab in a leaf. Closing the LAST tab removes the pane (collapses the split),
  // like VS Code — except the final remaining pane is kept (empty). Never closes the
  // window.
  const closeTab = useCallback((leafId: string, path: string) => {
    setTree((prev) => {
      const leaf = findLeaf(prev, leafId)
      if (!leaf) return prev
      const remaining = leaf.tabs.filter((t) => t.path !== path)
      // Last tab in this pane → remove the pane entirely.
      if (remaining.length === 0) {
        const res = removeLeaf(prev, leafId)
        if (!res) {
          // This was the only pane — keep it, emptied.
          return updateLeaf(prev, leafId, (l) => ({ ...l, tabs: [], activePath: null }))
        }
        setActiveLeafId(res.focusId)
        return res.tree
      }
      // Otherwise just drop the tab and pick a fallback active tab.
      return updateLeaf(prev, leafId, (l) => {
        const idx = l.tabs.findIndex((t) => t.path === path)
        const tabs = l.tabs.filter((t) => t.path !== path)
        let activePath = l.activePath
        if (path === l.activePath) {
          const fallback = tabs[idx] ?? tabs[idx - 1] ?? null
          activePath = fallback ? fallback.path : null
        }
        return { ...l, tabs, activePath }
      })
    })
  }, [])

  // Bulk-close for the tab context menu: keep only tabs passing `keep`; collapse the pane
  // when nothing remains (same last-tab semantics as closeTab above).
  const closeTabsWhere = useCallback((leafId: string, keep: (t: OpenTab, i: number) => boolean) => {
    setTree((prev) => {
      const leaf = findLeaf(prev, leafId)
      if (!leaf) return prev
      const remaining = leaf.tabs.filter((t, i) => keep(t, i))
      if (remaining.length === 0) {
        const res = removeLeaf(prev, leafId)
        if (!res) return updateLeaf(prev, leafId, (l) => ({ ...l, tabs: [], activePath: null }))
        setActiveLeafId(res.focusId)
        return res.tree
      }
      return updateLeaf(prev, leafId, (l) => {
        const tabs = l.tabs.filter((t, i) => keep(t, i))
        const activePath = tabs.some((t) => t.path === l.activePath)
          ? l.activePath
          : (tabs[tabs.length - 1]?.path ?? null)
        return { ...l, tabs, activePath }
      })
    })
  }, [])

  const closeOthers = useCallback((leafId: string, path: string) => {
    closeTabsWhere(leafId, (t) => t.path === path)
  }, [closeTabsWhere])

  const closeToTheRight = useCallback((leafId: string, path: string) => {
    const leaf = findLeaf(treeRef.current, leafId)
    const idx = leaf?.tabs.findIndex((t) => t.path === path) ?? -1
    if (idx < 0) return
    closeTabsWhere(leafId, (_t, i) => i <= idx)
  }, [closeTabsWhere])

  // Close every tab whose content matches disk (VS Code "Close Saved"). Untitled buffers
  // count as unsaved; preview/diff tabs are read-only and always "saved".
  const closeSaved = useCallback((leafId: string) => {
    closeTabsWhere(leafId, (t) => t.content !== t.savedContent || !!t.untitled)
  }, [closeTabsWhere])

  const closeAll = useCallback((leafId: string) => {
    closeTabsWhere(leafId, () => false)
  }, [closeTabsWhere])

  // Refs so once-subscribed handlers (menu events, key chords) always read current
  // focus/tree without re-subscribing. Declared before the pane ops that close over them.
  const activeLeafIdRef = useRef('')
  activeLeafIdRef.current = activeLeafId
  const treeRef = useRef(tree)
  treeRef.current = tree
  // Per-leaf open request token (leafId → counter). Bumped on every file open; a pending
  // async read aborts if its token is superseded, preventing stale reads from clobbering
  // the tab during rapid single-clicks or click→double-click races.
  const openTokens = useRef<Map<string, number>>(new Map())
  // Monotonic counter for Untitled-N buffer names/paths (per window — each renderer has its
  // own instance). Keyed off the counter, not the visible name, so closed untitled tabs
  // never cause synthetic-path collisions.
  const untitledSeq = useRef(0)

  // --- Pane operations (Emacs chords) ---

  const splitById = useCallback((leafId: string, orientation: 'row' | 'column') => {
    setTree((prev) => {
      const res = splitLeaf(prev, leafId, orientation)
      if (!res) return prev
      setActiveLeafId(res.newLeafId)
      return res.tree
    })
  }, [])

  const splitFocused = useCallback((orientation: 'row' | 'column') => {
    splitById(activeLeafIdRef.current, orientation)
  }, [splitById])

  // "Split Right" from the tab context menu: open THIS tab in a new pane to the right.
  // The clone drops `ephemeral` — a deliberately split-out editor is a kept editor.
  // Content stays in sync across the panes via changeContent's map-all-leaves update.
  const splitRightWithTab = useCallback((leafId: string, path: string) => {
    setTree((prev) => {
      const leaf = findLeaf(prev, leafId)
      const tab = leaf?.tabs.find((t) => t.path === path)
      if (!leaf || !tab) return prev
      const res = splitLeafWithTab(prev, leafId, 'row', { ...tab, ephemeral: undefined })
      if (!res) return prev
      setActiveLeafId(res.newLeafId)
      return res.tree
    })
  }, [])

  // Open a rendered Markdown/Mermaid preview of the focused file in a split to the side.
  // If a preview of this file is already open, just focus it.
  const openPreviewToSide = useCallback(() => {
    const leafId = activeLeafIdRef.current
    const leaf = findLeaf(treeRef.current, leafId)
    const src = leaf?.tabs.find((t) => t.path === leaf.activePath)
    if (!src || src.kind === 'preview' || !isPreviewable(src.name)) return
    const previewPath = `preview://${src.path}`
    // Already open somewhere? Focus that pane/tab.
    for (const l of leaves(treeRef.current)) {
      if (l.tabs.some((t) => t.path === previewPath)) {
        setActiveLeafId(l.id)
        setTree((prev) => updateLeaf(prev, l.id, (x) => ({ ...x, activePath: previewPath })))
        return
      }
    }
    const previewTab: OpenTab = {
      path: previewPath,
      name: `Preview ${src.name}`,
      content: src.content,
      savedContent: src.content,
      kind: 'preview',
      sourcePath: src.path,
    }
    setTree((prev) => {
      const res = splitLeafWithTab(prev, leafId, 'row', previewTab)
      if (!res) return prev
      setActiveLeafId(res.newLeafId)
      return res.tree
    })
  }, [])

  const closeFocusedPane = useCallback(() => {
    setTree((prev) => {
      const res = removeLeaf(prev, activeLeafIdRef.current)
      if (!res) return prev // was the only (root) pane → keep it
      setActiveLeafId(res.focusId)
      return res.tree
    })
  }, [])

  const soloFocusedPane = useCallback(() => {
    setTree((prev) => soloLeaf(prev, activeLeafIdRef.current))
  }, [])

  const resizeSplit = useCallback((splitId: string, sizes: number[]) => {
    setTree((prev) => setSplitSizes(prev, splitId, sizes))
  }, [])

  const saveFocused = useCallback(() => {
    const leaf = findLeaf(treeRef.current, activeLeafIdRef.current)
    if (leaf?.activePath) void saveTab(leaf.id, leaf.activePath)
  }, [saveTab])

  const closeFocusedTab = useCallback(() => {
    const leaf = findLeaf(treeRef.current, activeLeafIdRef.current)
    if (leaf?.activePath) closeTab(leaf.id, leaf.activePath)
  }, [closeTab])

  // Revert the focused tab to its last-saved content (Ctrl+9, like khef's editor).
  const revertFocusedTab = useCallback(() => {
    const leaf = findLeaf(treeRef.current, activeLeafIdRef.current)
    const tab = leaf?.tabs.find((t) => t.path === leaf.activePath)
    if (!leaf || !tab || tab.kind === 'preview') return
    if (tab.content === tab.savedContent) return
    // Restore content in every pane showing this file so split views stay in sync.
    setTree((prev) => mapLeaves(prev, (l) => ({
      ...l, tabs: l.tabs.map((t) => (t.path === tab.path ? { ...t, content: t.savedContent } : t)),
    })))
  }, [])

  // A file the OS asked us to open (Finder double-click / "Open With"), already read in
  // main as a loose file. Open it as a detached (loose) tab — it may live outside any
  // workspace root — and save back through the per-file loose-write gate.
  const openLoosePayload = useCallback((payload: { path: string; content: string } | undefined) => {
    if (!payload || typeof payload.path !== 'string') return
    const name = payload.path.split('/').pop() ?? payload.path
    void openPath(payload.path, name, { content: payload.content, loose: true })
  }, [openPath])

  // Menu wiring (open-file / open-folder / save / close-tab / quick-open / settings / split).
  useEffect(() => {
    const offOpenFile = window.editorApi.onMenu('menu:open-file', () => void openFileViaDialog())
    const offNewFile = window.editorApi.onMenu('menu:new-file', () => newUntitled())
    const offOpenLoose = window.editorApi.onMenu('menu:open-loose', (payload) => openLoosePayload(payload))
    const offOpen = window.editorApi.onMenu('menu:open-folder', () => void openFolder())
    const offSave = window.editorApi.onMenu('menu:save', () => saveFocused())
    const offQuick = window.editorApi.onMenu('menu:quick-open', () => setQuickOpen((v) => !v))
    const offSettings = window.editorApi.onMenu('menu:settings', () => setSettingsOpen((v) => !v))
    const offCloseTab = window.editorApi.onMenu('menu:close-tab', () => closeFocusedTab())
    const offSplit = window.editorApi.onMenu('menu:split', () => splitFocused('row'))
    const offToggleSidebar = window.editorApi.onMenu('menu:toggle-sidebar', () => toggleSidebar())
    const offPreview = window.editorApi.onMenu('menu:preview-side', () => openPreviewToSide())
    const offOpenRecent = window.editorApi.onMenu('menu:open-recent', (dir) => { if (dir) void openFolder(dir) })
    const offClearRecent = window.editorApi.onMenu('menu:clear-recent', () => { void window.editorApi.clearRecentFolders().then(setRecentFolders) })
    return () => { offOpenFile(); offNewFile(); offOpenLoose(); offOpen(); offSave(); offQuick(); offSettings(); offCloseTab(); offSplit(); offToggleSidebar(); offPreview(); offOpenRecent(); offClearRecent() }
  }, [openFileViaDialog, newUntitled, openLoosePayload, openFolder, saveFocused, closeFocusedTab, splitFocused, toggleSidebar, openPreviewToSide])

  // Emacs-style C-x prefix chord handling for pane commands, plus Cmd+P.
  const prefixRef = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+P quick open. Cmd only (NOT Ctrl) so Ctrl+P stays free for the editor's
      // Emacs cursor-up binding.
      if (e.metaKey && !e.ctrlKey && e.key === 'p' && !e.altKey) {
        e.preventDefault()
        if (root) setQuickOpen((v) => !v)
        return
      }
      // Ctrl+9 — revert the focused tab to its saved content (Emacs-friendly, like khef).
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '9' || e.code === 'Digit9')) {
        e.preventDefault()
        e.stopPropagation()
        revertFocusedTab()
        return
      }
      // Arm the C-x prefix.
      if (e.ctrlKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault()
        prefixRef.current = true
        return
      }
      // Second key of the chord.
      if (prefixRef.current) {
        if (e.key === '3') { e.preventDefault(); splitFocused('row') }
        else if (e.key === '2') { e.preventDefault(); splitFocused('column') }
        else if (e.key === '1') { e.preventDefault(); soloFocusedPane() }
        else if (e.key === '0') { e.preventDefault(); closeFocusedPane() }
        else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); selectAllInActiveEditor() } // C-x h: select all
        // Any key ends the prefix (whether or not it was a pane command).
        prefixRef.current = false
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [root, splitFocused, soloFocusedPane, closeFocusedPane, revertFocusedTab])

  const allLeaves = leaves(tree)
  const focusedLeaf = findLeaf(tree, activeLeafId) ?? allLeaves[0]
  const focusedTab = focusedLeaf?.tabs.find((t) => t.path === focusedLeaf.activePath) ?? null
  const treeActivePath = focusedLeaf?.activePath ?? null
  const paneCount = allLeaves.length

  return (
    <div class="shell" style={{ '--sidebar-w': sidebarCollapsed ? '0px' : `${sidebarWidth}px` } as Record<string, string>}>
      <nav class="activitybar">
        <button
          class={`act-btn${sidebarView === 'explorer' && !settingsOpen && !sidebarCollapsed ? ' active' : ''}`}
          title="Explorer"
          onClick={() => selectView('explorer')}
        >
          <Files size={22} />
        </button>
        <button
          class={`act-btn${sidebarView === 'search' && !settingsOpen && !sidebarCollapsed ? ' active' : ''}`}
          title="Search"
          onClick={() => selectView('search')}
        >
          <SearchIcon size={22} />
        </button>
        <button
          class={`act-btn${sidebarView === 'scm' && !settingsOpen && !sidebarCollapsed ? ' active' : ''}`}
          title="Source Control"
          onClick={() => selectView('scm')}
        >
          <GitBranch size={22} />
        </button>
        <span class="act-spacer" />
        <button
          class={`act-btn${settingsOpen ? ' active' : ''}`}
          title="Settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings size={22} />
        </button>
      </nav>

      <aside class="sidebar" data-testid="sidebar">
        {/* Both views stay mounted; we toggle visibility so each keeps its state
            (the search query/results survive switching to Explorer and back). */}
        <div class={`sidebar-view${sidebarView === 'explorer' ? '' : ' hidden'}`}>
          <div class="sidebar-header">Explorer</div>
          <OpenEditors
            leaves={allLeaves}
            activeLeafId={activeLeafId}
            onActivate={activateTab}
            onClose={closeTab}
          />
          {root ? (
            <>
              <div class="explorer-root">{rootName}</div>
              <FileTree entries={entries} activePath={treeActivePath} onOpenFile={openFile} onOpenFilePermanent={openFilePermanent} />
            </>
          ) : (
            <div class="sidebar-empty">
              <button class="open-btn" onClick={() => void openFolder()}>Open Folder</button>
            </div>
          )}
        </div>
        <div class={`sidebar-view${sidebarView === 'search' ? '' : ' hidden'}`}>
          {root ? (
            <SearchPanel onOpenMatch={openMatch} />
          ) : (
            <>
              <div class="sidebar-header">Search</div>
              <div class="sidebar-empty"><p class="hint">Open a folder to search.</p></div>
            </>
          )}
        </div>
        <div class={`sidebar-view${sidebarView === 'scm' ? '' : ' hidden'}`}>
          {root ? (
            <SourceControlPanel refreshToken={scmRefresh} onOpenDiff={openDiff} />
          ) : (
            <>
              <div class="sidebar-header">Source Control</div>
              <div class="sidebar-empty"><p class="hint">Open a folder to see source control.</p></div>
            </>
          )}
        </div>
      </aside>

      <div
        class={`sidebar-resizer${sidebarCollapsed ? ' collapsed' : ''}`}
        onPointerDown={startSidebarDrag}
        data-testid="sidebar-resizer"
      />

      <main class="editor-area">
        {settingsOpen ? (
          <SettingsPanel
            activeTheme={themeId}
            onSelectTheme={selectTheme}
            onClose={() => setSettingsOpen(false)}
          />
        ) : (
          <div class="pane-root">
            <PaneTree
              node={tree}
              activeLeafId={activeLeafId}
              themeId={themeId}
              gotoLine={pendingJump}
              onFocus={setActiveLeafId}
              onActivateTab={activateTab}
              onCloseTab={closeTab}
              onChangeContent={changeContent}
              onUserEdit={editTab}
              onPromoteTab={promoteTab}
              onTabContextMenu={(leafId, path, e) => setTabMenu({ leafId, path, x: e.clientX, y: e.clientY })}
              onSave={(leafId, path) => void saveTab(leafId, path)}
              onResize={resizeSplit}
              onOpenFolder={() => void openFolder()}
              onOpenFile={() => void openFileViaDialog()}
              onOpenSettings={() => setSettingsOpen(true)}
              recentFolders={recentFolders}
              onOpenRecent={(dir) => void openFolder(dir)}
            />
          </div>
        )}
      </main>

      <footer class="statusbar" data-testid="statusbar">
        <span class="status-left">
          {root ? rootName : 'No folder'}
          {focusedTab && ` — ${focusedTab.name}${focusedTab.content !== focusedTab.savedContent ? ' ●' : ''}`}
          {paneCount > 1 && `  ·  ${paneCount} panes`}
        </span>
        <span class="status-right">
          {selStatus && <span class="status-selection" data-testid="status-selection">{selStatus}  ·  </span>}
          {error ? `⚠ ${error}` : 'khef-editor v0.1.0'}
        </span>
      </footer>

      {quickOpen && root && (
        <QuickOpen onPick={pickQuickOpen} onClose={() => setQuickOpen(false)} />
      )}

      {tabMenu && (() => {
        const menuLeaf = findLeaf(tree, tabMenu.leafId)
        const menuTab = menuLeaf?.tabs.find((t) => t.path === tabMenu.path)
        if (!menuLeaf || !menuTab) return null
        const idx = menuLeaf.tabs.findIndex((t) => t.path === menuTab.path)
        // Untitled/preview/diff tabs have synthetic paths — no disk path to copy or reveal.
        const synthetic = !!menuTab.untitled || menuTab.kind === 'preview' || menuTab.kind === 'diff'
        const relPath = root && menuTab.path.startsWith(root + '/') ? menuTab.path.slice(root.length + 1) : null
        const entries: MenuEntry[] = [
          { kind: 'item', label: 'Close', hint: '⌘W', onClick: () => closeTab(menuLeaf.id, menuTab.path) },
          { kind: 'item', label: 'Close Others', disabled: menuLeaf.tabs.length < 2, onClick: () => closeOthers(menuLeaf.id, menuTab.path) },
          { kind: 'item', label: 'Close to the Right', disabled: idx >= menuLeaf.tabs.length - 1, onClick: () => closeToTheRight(menuLeaf.id, menuTab.path) },
          { kind: 'item', label: 'Close Saved', onClick: () => closeSaved(menuLeaf.id) },
          { kind: 'item', label: 'Close All', onClick: () => closeAll(menuLeaf.id) },
          { kind: 'separator' },
          { kind: 'item', label: 'Copy Path', disabled: synthetic, onClick: () => void navigator.clipboard.writeText(menuTab.path) },
          { kind: 'item', label: 'Copy Relative Path', disabled: synthetic || !relPath, onClick: () => { if (relPath) void navigator.clipboard.writeText(relPath) } },
          { kind: 'separator' },
          { kind: 'item', label: 'Reveal in Finder', disabled: synthetic, onClick: () => {
              window.editorApi.revealInFinder(menuTab.path).catch((e) => setError(e instanceof Error ? e.message : String(e)))
            } },
          { kind: 'separator' },
          { kind: 'item', label: 'Keep Open', disabled: !menuTab.ephemeral, onClick: () => promoteTab(menuLeaf.id, menuTab.path) },
          { kind: 'separator' },
          { kind: 'item', label: 'Split Right', onClick: () => splitRightWithTab(menuLeaf.id, menuTab.path) },
        ]
        return <ContextMenu x={tabMenu.x} y={tabMenu.y} entries={entries} onClose={() => setTabMenu(null)} />
      })()}
    </div>
  )
}
