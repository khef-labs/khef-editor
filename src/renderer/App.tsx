import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { Files, Search as SearchIcon, GitBranch, Settings } from 'lucide-preact'
import type { FsTreeEntry, FileListEntry } from '../../electron/types'
import { FileTree } from './components/FileTree'
import { QuickOpen } from './components/QuickOpen'
import { SettingsPanel } from './components/SettingsPanel'
import { SearchPanel } from './components/SearchPanel'
import { PaneTree } from './components/PaneTree'
import { themeById, applyTheme } from './lib/themes'
import {
  makeLeaf, leaves, findLeaf, updateLeaf, mapLeaves, splitLeaf, removeLeaf, soloLeaf, setSplitSizes,
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
  const [sidebarView, setSidebarView] = useState<'explorer' | 'search'>('explorer')
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number; token: number } | null>(null)
  const jumpTokenRef = useRef(0)
  const [themeId, setThemeId] = useState<string>('dark-plus')
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  }, [])

  // Sidebar resize drag. Below COLLAPSE_AT the sidebar snaps closed (VS Code-style);
  // it can't be shrunk to a sliver — it's either >= MIN_W or hidden.
  const MIN_W = 170
  const COLLAPSE_AT = 120
  const MAX_W = 700
  const startSidebarDrag = useCallback((e: PointerEvent) => {
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('dragging')
    const startX = e.clientX
    // When collapsed, the visible width is 0, so grow from there as the user drags right.
    const startW = sidebarCollapsed ? 0 : sidebarWidth
    let collapsed = sidebarCollapsed
    let width = sidebarCollapsed ? sidebarWidth : sidebarWidth
    const onMove = (ev: PointerEvent) => {
      const raw = startW + (ev.clientX - startX)
      if (raw < COLLAPSE_AT) {
        collapsed = true
        setSidebarCollapsed(true)
      } else {
        collapsed = false
        width = Math.max(MIN_W, Math.min(MAX_W, raw))
        setSidebarCollapsed(false)
        setSidebarWidth(width)
      }
    }
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId)
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      // Persist width only when not collapsed; keep last width to restore on reopen.
      if (!collapsed) void window.editorApi.setSettings({ sidebarWidth: Math.round(width) })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }, [sidebarWidth])

  // Clicking an activity-bar view icon: open that view, or toggle collapse if it's the
  // already-active view (VS Code behavior).
  const selectView = useCallback((view: 'explorer' | 'search') => {
    setSettingsOpen(false)
    if (!sidebarCollapsed && sidebarView === view) {
      setSidebarCollapsed(true)
    } else {
      setSidebarCollapsed(false)
      setSidebarView(view)
    }
  }, [sidebarCollapsed, sidebarView])

  const selectTheme = useCallback((id: string) => {
    const t = themeById(id)
    setThemeId(t.id)
    applyTheme(t)
    void window.editorApi.setSettings({ theme: t.id })
  }, [])

  const openFolder = useCallback(async () => {
    setError(null)
    try {
      const res = await window.editorApi.openWorkspace()
      if (!res) return
      setRoot(res.root)
      setRootName(res.root.split('/').filter(Boolean).pop() ?? res.root)
      const t = await window.editorApi.tree(res.root, 1)
      setEntries(t.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Open a file into the focused leaf (or activate it there if already open). When
  // `preloaded` is given (loose file already read in main), skip the confined read.
  const openPath = useCallback(async (
    filePath: string,
    name: string,
    preloaded?: { content: string; loose?: boolean },
  ) => {
    setError(null)
    const leaf = findLeaf(tree, activeLeafId)
    const already = leaf?.tabs.find((t) => t.path === filePath)
    if (already) {
      setTree((prev) => updateLeaf(prev, activeLeafId, (l) => ({ ...l, activePath: filePath })))
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
    setTree((prev) => updateLeaf(prev, activeLeafId, (l) => {
      const tab: OpenTab = { path: filePath, name, content, savedContent: content, loose: preloaded?.loose }
      return { ...l, tabs: [...l.tabs, tab], activePath: filePath }
    }))
  }, [tree, activeLeafId])

  const openFile = useCallback((entry: FsTreeEntry) => {
    if (entry.type !== 'file') return
    void openPath(entry.path, entry.name)
  }, [openPath])

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

  const changeContent = useCallback((leafId: string, path: string, content: string) => {
    setTree((prev) => updateLeaf(prev, leafId, (l) => ({
      ...l, tabs: l.tabs.map((t) => (t.path === path ? { ...t, content } : t)),
    })))
  }, [])

  const saveTab = useCallback(async (leafId: string, path: string) => {
    const leaf = findLeaf(tree, leafId)
    const tab = leaf?.tabs.find((t) => t.path === path)
    if (!tab) return
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tree])

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

  // Refs so once-subscribed handlers (menu events, key chords) always read current
  // focus/tree without re-subscribing. Declared before the pane ops that close over them.
  const activeLeafIdRef = useRef('')
  activeLeafIdRef.current = activeLeafId
  const treeRef = useRef(tree)
  treeRef.current = tree

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

  // Menu wiring (open-file / open-folder / save / close-tab / quick-open / settings / split).
  useEffect(() => {
    const offOpenFile = window.editorApi.onMenu('menu:open-file', () => void openFileViaDialog())
    const offOpen = window.editorApi.onMenu('menu:open-folder', () => void openFolder())
    const offSave = window.editorApi.onMenu('menu:save', () => saveFocused())
    const offQuick = window.editorApi.onMenu('menu:quick-open', () => setQuickOpen((v) => !v))
    const offSettings = window.editorApi.onMenu('menu:settings', () => setSettingsOpen((v) => !v))
    const offCloseTab = window.editorApi.onMenu('menu:close-tab', () => closeFocusedTab())
    const offSplit = window.editorApi.onMenu('menu:split', () => splitFocused('row'))
    return () => { offOpenFile(); offOpen(); offSave(); offQuick(); offSettings(); offCloseTab(); offSplit() }
  }, [openFileViaDialog, openFolder, saveFocused, closeFocusedTab, splitFocused])

  // Emacs-style C-x prefix chord handling for pane commands, plus Cmd+P.
  const prefixRef = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+P quick open (independent of the C-x prefix).
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.altKey) {
        e.preventDefault()
        if (root) setQuickOpen((v) => !v)
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
        // Any key ends the prefix (whether or not it was a pane command).
        prefixRef.current = false
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [root, splitFocused, soloFocusedPane, closeFocusedPane])

  const focusedLeaf = findLeaf(tree, activeLeafId) ?? leaves(tree)[0]
  const focusedTab = focusedLeaf?.tabs.find((t) => t.path === focusedLeaf.activePath) ?? null
  const treeActivePath = focusedLeaf?.activePath ?? null
  const paneCount = leaves(tree).length

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
        <button class="act-btn" title="Source Control (coming)"><GitBranch size={22} /></button>
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
          {root ? (
            <>
              <div class="explorer-root">{rootName}</div>
              <FileTree entries={entries} activePath={treeActivePath} onOpenFile={openFile} />
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
              onSave={(leafId, path) => void saveTab(leafId, path)}
              onResize={resizeSplit}
              onOpenFolder={() => void openFolder()}
              onOpenFile={() => void openFileViaDialog()}
              onOpenSettings={() => setSettingsOpen(true)}
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
        <span class="status-right">{error ? `⚠ ${error}` : 'khef-editor v0.1.0'}</span>
      </footer>

      {quickOpen && root && (
        <QuickOpen onPick={pickQuickOpen} onClose={() => setQuickOpen(false)} />
      )}
    </div>
  )
}
