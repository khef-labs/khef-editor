import { useEffect, useRef, useState, useCallback } from 'preact/hooks'
import { EditorState, Compartment, EditorSelection, Prec, Annotation, Transaction, type SelectionRange } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import {
  search, setSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll,
  openSearchPanel, closeSearchPanel, selectNextOccurrence,
} from '@codemirror/search'
import { FindWidget } from './FindWidget'
import { computeMatchState, type MatchRange } from '../lib/findMatches'
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
  cursorCharForward, cursorCharBackward, cursorLineUp, cursorLineDown,
  cursorLineStart, cursorLineEnd, cursorDocStart, cursorDocEnd,
  cursorGroupForward, cursorGroupBackward,
  selectCharForward, selectCharBackward, selectLineUp, selectLineDown,
  selectLineStart, selectLineEnd, selectGroupForward, selectGroupBackward,
  selectLine, deleteLine,
} from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { languageForFilename } from '../lib/language'
import { editorThemeExtension } from '../lib/editorTheme'
import type { EditorThemeKey } from '../lib/themes'

// Overview-ruler cursor marker: a small tick on the editor's right edge showing where
// the cursor line sits within the whole document (VS Code's scrollbar cursor marker).
const cursorOverviewMarker = ViewPlugin.fromClass(
  class {
    marker: HTMLDivElement
    view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.marker = document.createElement('div')
      this.marker.className = 'cm-cursor-overview'
      // Appended to .cm-editor (does not scroll) so the tick stays fixed to the viewport
      // right edge at the cursor row's on-screen Y.
      view.dom.appendChild(this.marker)
      // Defer the first placement until after the view has been measured.
      view.requestMeasure({ read: () => this.reposition(view) })
    }
    update(update: ViewUpdate) {
      // Reposition on cursor move, edits, and any geometry/viewport change (scrolling).
      this.reposition(update.view)
    }
    reposition(view: EditorView) {
      // VS Code's overview-ruler cursor marker is ALWAYS document-relative: it sits in the
      // scrollbar lane at (cursorLine / totalLines) of the editor height, regardless of
      // where the viewport is scrolled. It does not track the cursor's on-screen row.
      const head = view.state.selection.main.head
      const totalLines = view.state.doc.lines
      const cursorLine = view.state.doc.lineAt(head).number
      const frac = totalLines > 1 ? (cursorLine - 1) / (totalLines - 1) : 0
      const trackH = view.dom.clientHeight
      const top = Math.round(frac * (trackH - 3))
      this.marker.style.display = 'block'
      this.marker.style.top = `${top}px`
    }
    destroy() {
      this.marker.remove()
    }
  },
  {
    // coordsAtPos is viewport-relative, so reposition on scroll too.
    eventHandlers: {
      scroll() {
        const self = this as unknown as { reposition(v: EditorView): void; view?: EditorView }
        if (self.view) self.reposition(self.view)
      },
    },
  },
)

interface CodeEditorProps {
  // Identity of the open doc. When this changes, the document is replaced.
  path: string
  filename: string
  value: string
  themeKey: EditorThemeKey
  // A jump request: { line, token } — bump `token` to re-trigger a jump to the same line.
  gotoLine?: { line: number; token: number } | null
  onChange: (value: string) => void
  onSave: () => void
  // Fired only for USER-originated edits (typing, kill/yank, etc.) — NOT for programmatic
  // doc replacement (path swap, value sync). Used to promote a preview (ephemeral) tab to a
  // permanent one, since editing a soft-opened file commits it (VS Code behavior).
  onUserEdit?: () => void
}

// Marks a transaction as a programmatic document replacement (path swap / external value
// sync) so the update listener can distinguish it from a genuine user edit.
const ProgrammaticDoc = Annotation.define<boolean>()

// A hidden CodeMirror search panel. We render our OWN floating find widget, but CM's
// native match highlighting (.cm-searchMatch) only draws when the search panel STATE is
// open (searchHighlighter returns no decorations when panel is null). So we install
// search() with this empty, display:none panel and open it behind our widget — the user
// never sees it, but the highlights work. (plan-find-widget, lissy finding #1.)
function hiddenSearchPanel() {
  const dom = document.createElement('div')
  dom.className = 'cm-hidden-search-panel'
  dom.style.display = 'none'
  return { dom, top: true }
}

type CMCommand = (view: EditorView) => boolean

// Emacs kill ring — shared across all editors (like Emacs), mirroring khef's editor.
let killRing = ''

// The most-recently-focused editor view, so app-level chords (e.g. C-x h select-all)
// can target the active editor.
let activeEditorView: EditorView | null = null

export function selectAllInActiveEditor(): boolean {
  const view = activeEditorView
  if (!view) return false
  view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) })
  view.focus()
  return true
}

// Selection status for the app status bar ("3 selections" for Cmd+D multi-cursor,
// "12 selected" for a single range). Module-level listener, same pattern as
// activeEditorView — avoids threading a callback through PaneTree/EditorGroupView.
let selectionStatusListener: ((label: string) => void) | null = null

export function setSelectionStatusListener(fn: ((label: string) => void) | null): void {
  selectionStatusListener = fn
}

function selectionLabel(state: EditorState): string {
  const { ranges } = state.selection
  if (ranges.length > 1) return `${ranges.length} selections`
  const main = state.selection.main
  if (!main.empty) return `${main.to - main.from} selected`
  return ''
}

function moveByLineBoundary(view: EditorView, start: SelectionRange, forward: boolean): SelectionRange {
  const line = view.lineBlockAt(start.head)
  let moved = view.moveToLineBoundary(start, forward)
  if (moved.head === start.head && moved.head !== (forward ? line.to : line.from)) {
    moved = view.moveToLineBoundary(start, forward, false)
  }
  if (!forward && moved.head === line.from && line.length) {
    const indent = /^\s*/.exec(view.state.sliceDoc(line.from, Math.min(line.from + 100, line.to)))?.[0].length ?? 0
    if (indent && start.head !== line.from + indent) {
      moved = EditorSelection.cursor(line.from + indent)
    }
  }
  return moved
}

function extendSelection(view: EditorView, move: (range: SelectionRange) => SelectionRange): boolean {
  const selection = EditorSelection.create(
    view.state.selection.ranges.map((range) => {
      const moved = move(range)
      return EditorSelection.range(range.anchor, moved.head, moved.goalColumn, moved.bidiLevel ?? undefined, moved.assoc)
    }),
    view.state.selection.mainIndex,
  )
  if (selection.eq(view.state.selection, true)) return false
  view.dispatch(view.state.update({ selection, scrollIntoView: true, userEvent: 'select' }))
  return true
}

export function CodeEditor({ path, filename, value, themeKey, gotoLine, onChange, onSave, onUserEdit }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageComp = useRef(new Compartment())
  const themeComp = useRef(new Compartment())
  // Keep latest callbacks without rebuilding the view.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onUserEditRef = useRef(onUserEdit)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onUserEditRef.current = onUserEdit
  // Emacs "mark" (set with C-Space): when active, motion commands extend the selection.
  const markActiveRef = useRef(false)
  // Value-sync loop guards (ported from khef's CodeEditor, commits cfb64e9 / fe52cde).
  // Without these, typing → onChange → App setTree → new `value` prop → the value-sync
  // effect re-dispatches the doc → updateListener fires onChange again → runaway loop that
  // freezes the renderer. `isApplyingExternalUpdate` marks a programmatic doc replacement so
  // the updateListener skips re-emitting; `emitCounter` lets the value effect ignore a stale
  // `value` prop from an intermediate render that would clobber the user's latest keystroke.
  const isApplyingExternalUpdateRef = useRef(false)
  const emitCounterRef = useRef(0)

  // --- In-editor Find/Replace widget state (VS Code-style). ---
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findReplace, setFindReplace] = useState('')
  const [findCase, setFindCase] = useState(false)
  const [findWord, setFindWord] = useState(false)
  const [findRegex, setFindRegex] = useState(false)
  const [findInSelection, setFindInSelection] = useState(false)
  const [replaceExpanded, setReplaceExpanded] = useState(false)
  const [matchState, setMatchState] = useState<{ current: number; total: number; invalid: boolean }>({ current: 0, total: 0, invalid: false })
  // The frozen scope range when "find in selection" is on (captured once, not the live
  // selection — findNext collapses the selection to the match, which would shrink scope).
  const scopeRef = useRef<MatchRange | null>(null)
  // The last NON-EMPTY selection the user made in the editor. Tracked live via the update
  // listener so "find in selection" can scope to it even after focus moved to the Find
  // input (which collapses the editor's live selection). Cleared when a match is selected
  // by find nav so it reflects a real user range, not a search hit.
  const lastSelectionRef = useRef<MatchRange | null>(null)

  // Push the current find query/flags into CodeMirror and recompute the match count.
  const applyQuery = useCallback((opts?: { query?: string; caseSensitive?: boolean; wholeWord?: boolean; regexp?: boolean }) => {
    const view = viewRef.current
    if (!view) return
    const q = opts?.query ?? findQuery
    const cs = opts?.caseSensitive ?? findCase
    const ww = opts?.wholeWord ?? findWord
    const re = opts?.regexp ?? findRegex
    const scope = scopeRef.current
    const test = scope
      ? (_m: string, _s: EditorState, from: number, to: number) => from >= scope.from && to <= scope.to
      : undefined
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: q, caseSensitive: cs, wholeWord: ww, regexp: re, replace: findReplace, test })) })
    const sel = view.state.selection.main
    const state = computeMatchState(view.state.doc.toString(), q, { caseSensitive: cs, wholeWord: ww, regexp: re }, { from: sel.from, to: sel.to }, scope)
    setMatchState(state)
  }, [findQuery, findReplace, findCase, findWord, findRegex])

  // Recompute the "N of M" label (e.g. after nav moves the selection).
  const recount = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const sel = view.state.selection.main
    const state = computeMatchState(view.state.doc.toString(), findQuery, { caseSensitive: findCase, wholeWord: findWord, regexp: findRegex }, { from: sel.from, to: sel.to }, scopeRef.current)
    setMatchState(state)
  }, [findQuery, findCase, findWord, findRegex])

  // Open the find widget. `withReplace` expands the replace row. Seeds the query from a
  // single-line selection; auto-enables find-in-selection (frozen range) for a multi-line one.
  const openFind = useCallback((withReplace: boolean) => {
    const view = viewRef.current
    if (!view) return
    openSearchPanel(view) // opens the HIDDEN panel state so native highlights draw
    const sel = view.state.selection.main
    const selText = view.state.sliceDoc(sel.from, sel.to)
    // Remember the selection so the `≡` toggle can scope to it after focus leaves the editor.
    lastSelectionRef.current = sel.empty ? lastSelectionRef.current : { from: sel.from, to: sel.to }
    const multiLine = selText.includes('\n')
    if (multiLine) {
      // Multi-line selection → auto-enable find-in-selection with the frozen range.
      scopeRef.current = { from: sel.from, to: sel.to }
      setFindInSelection(true)
    } else {
      scopeRef.current = null
      setFindInSelection(false)
      if (selText.length > 0) setFindQuery(selText) // single-line → prefill the query
    }
    if (withReplace) setReplaceExpanded(true)
    setFindOpen(true)
  }, [])
  const openFindRef = useRef(openFind)
  openFindRef.current = openFind

  const closeFind = useCallback(() => {
    const view = viewRef.current
    setFindOpen(false)
    scopeRef.current = null
    setFindInSelection(false)
    if (view) { closeSearchPanel(view); view.focus() }
  }, [])

  // Re-apply the query whenever it or the flags change while the widget is open.
  useEffect(() => {
    if (findOpen) applyQuery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findQuery, findCase, findWord, findRegex, findReplace, findInSelection])

  const runFindNext = useCallback(() => { const v = viewRef.current; if (v) { findNext(v); recount() } }, [recount])
  const runFindPrev = useCallback(() => { const v = viewRef.current; if (v) { findPrevious(v); recount() } }, [recount])
  const runReplaceOne = useCallback(() => { const v = viewRef.current; if (v) { replaceNext(v); recount() } }, [recount])
  const runReplaceAll = useCallback(() => { const v = viewRef.current; if (v) { replaceAll(v); recount() } }, [recount])

  const toggleInSelection = useCallback(() => {
    if (scopeRef.current) {
      // Turn it off → back to whole-document search.
      scopeRef.current = null
      setFindInSelection(false)
    } else {
      // Turn it on → scope to the last real user selection (captured live, since focus is
      // now in the Find input and the editor's selection is collapsed).
      const remembered = lastSelectionRef.current
      if (remembered && remembered.from !== remembered.to) {
        scopeRef.current = { ...remembered }
        setFindInSelection(true)
      }
    }
    applyQuery()
  }, [applyQuery])

  const onFindKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? runFindPrev() : runFindNext() }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind() }
  }, [runFindNext, runFindPrev, closeFind])

  const onReplaceKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); runReplaceOne() }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind() }
  }, [runReplaceOne, closeFind])

  // Build the Emacs keybinding extension. Mirrors khef's editor: mark + region, kill ring
  // (C-k / C-w / C-y), open line (C-o), readline motion (C-f/b/p/n/a/e), word motion
  // (M-f/b), and document jumps (M-< / M->). Movement extends the selection when the mark
  // is active. Word/doc motion lives in domEventHandlers because macOS Option transforms
  // the typed character, breaking CM6 keymap matching (event.code is stable).
  const buildEmacsExtension = () => {
    const clearMark = (view?: EditorView | null) => {
      markActiveRef.current = false
      if (!view) return
      const { main } = view.state.selection
      if (!main.empty) view.dispatch({ selection: EditorSelection.cursor(main.head) })
    }
    const setMark = (view: EditorView) => {
      markActiveRef.current = true
      view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) })
      return true
    }
    const motion = (move: CMCommand, selectMove: CMCommand): CMCommand =>
      (view) => (markActiveRef.current ? selectMove(view) : move(view))

    return Prec.highest(keymap.of([
      { key: 'Ctrl-Space', preventDefault: true, run: setMark },
      { key: 'Ctrl-g', run: (view) => {
          if (!markActiveRef.current && view.state.selection.main.empty) return false
          clearMark(view); return true
        } },
      { key: 'Ctrl-p', preventDefault: true, run: motion(cursorLineUp, selectLineUp) },
      { key: 'Ctrl-n', preventDefault: true, run: motion(cursorLineDown, selectLineDown) },
      { key: 'Ctrl-f', preventDefault: true, run: motion(cursorCharForward, selectCharForward) },
      { key: 'Ctrl-b', preventDefault: true, run: motion(cursorCharBackward, selectCharBackward) },
      { key: 'Ctrl-a', preventDefault: true, run: motion(cursorLineStart, selectLineStart) },
      { key: 'Ctrl-e', preventDefault: true, run: motion(cursorLineEnd, selectLineEnd) },
      { key: 'Ctrl-d', preventDefault: true, run: (view) => {
          const { head } = view.state.selection.main
          if (head >= view.state.doc.length) return false
          view.dispatch({ changes: { from: head, to: head + 1 } }); return true
        } },
      { key: 'Ctrl-k', preventDefault: true, run: (view) => {
          const { head } = view.state.selection.main
          const line = view.state.doc.lineAt(head)
          const to = head >= line.to ? Math.min(line.to + 1, view.state.doc.length) : line.to
          if (head === to) return false
          killRing = view.state.sliceDoc(head, to)
          view.dispatch({ changes: { from: head, to } })
          markActiveRef.current = false
          navigator.clipboard.writeText(killRing).catch(() => {})
          return true
        } },
      { key: 'Ctrl-w', preventDefault: true, run: (view) => {
          const { main } = view.state.selection
          if (main.empty) return false
          killRing = view.state.sliceDoc(main.from, main.to)
          view.dispatch({ changes: { from: main.from, to: main.to }, selection: EditorSelection.cursor(main.from) })
          markActiveRef.current = false
          navigator.clipboard.writeText(killRing).catch(() => {})
          return true
        } },
      { key: 'Alt-w', preventDefault: true, run: (view) => {
          const { main } = view.state.selection
          if (main.empty) return false
          killRing = view.state.sliceDoc(main.from, main.to)
          navigator.clipboard.writeText(killRing).catch(() => {})
          clearMark(view)
          return true
        } },
      { key: 'Ctrl-y', preventDefault: true, run: (view) => {
          if (!killRing) return false
          const { main } = view.state.selection
          view.dispatch({
            changes: { from: main.from, to: main.to, insert: killRing },
            selection: EditorSelection.cursor(main.from + killRing.length),
          })
          return true
        } },
      { key: 'Ctrl-o', preventDefault: true, run: (view) => {
          const { head } = view.state.selection.main
          const line = view.state.doc.lineAt(head)
          view.dispatch({ changes: { from: line.from, insert: '\n' }, selection: EditorSelection.cursor(line.from) })
          return true
        } },
      { key: 'Ctrl-z', preventDefault: true, run: (view) => undo(view) },
      { key: 'Ctrl-Shift-z', preventDefault: true, run: (view) => redo(view) },
      { key: 'Ctrl-/', preventDefault: true, run: (view) => undo(view) }, // Emacs C-/ undo
    ]))
  }

  // Word/doc motion via DOM events (macOS Option transforms event.key; event.code is stable).
  // Shift+arrow selection is handled here too because the browser/Electron event is the
  // ground truth for these native-feeling selection chords.
  const emacsDomHandlers = () => EditorView.domEventHandlers({
    keydown: (ev, view) => {
      const event = ev as KeyboardEvent
      if (event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        const right = event.key === 'ArrowRight'
        let handled = false
        if (event.metaKey && !event.altKey && !event.ctrlKey) {
          handled = extendSelection(view, (range) => moveByLineBoundary(view, range, right))
        } else if (event.altKey && !event.metaKey && !event.ctrlKey) {
          handled = extendSelection(view, (range) => view.moveByGroup(range, right))
        } else if (!event.altKey && !event.metaKey && !event.ctrlKey) {
          handled = extendSelection(view, (range) => view.moveByChar(range, right))
        }
        if (handled) {
          event.preventDefault()
          return true
        }
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.code === 'KeyF' || event.code === 'KeyB') {
          event.preventDefault()
          const fwd = event.code === 'KeyF'
          if (markActiveRef.current) (fwd ? selectGroupForward : selectGroupBackward)(view)
          else (fwd ? cursorGroupForward : cursorGroupBackward)(view)
          return true
        }
        if (event.shiftKey && (event.code === 'Comma' || event.code === 'Period')) {
          event.preventDefault()
          const toStart = event.code === 'Comma'
          if (markActiveRef.current) {
            const anchor = view.state.selection.main.anchor
            view.dispatch({ selection: EditorSelection.range(anchor, toStart ? 0 : view.state.doc.length), scrollIntoView: true })
          } else {
            (toStart ? cursorDocStart : cursorDocEnd)(view)
          }
          return true
        }
      }
      return false
    },
    mousedown: (_e, view) => { markActiveRef.current = false; activeEditorView = view; return false },
    focusin: (_e, view) => {
      activeEditorView = view
      selectionStatusListener?.(selectionLabel(view.state)) // switching panes → show this editor's selection
      return false
    },
  })

  // Build the view once.
  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        buildEmacsExtension(),
        emacsDomHandlers(),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        // Tag the editor with .cm-has-selection whenever a selection exists. drawSelection()
        // renders the selection layer BEHIND the content, so the opaque --active-line
        // background would otherwise completely cover the selection on the caret's line —
        // making keyboard selection (Shift+Arrow / word / line) look like it does nothing.
        // The theme below hides the active-line highlight while selecting (VS Code behavior).
        EditorView.editorAttributes.compute(['selection'], (s) =>
          ({ class: s.selection.ranges.some((r) => !r.empty) ? 'cm-has-selection' : '' })),
        cursorOverviewMarker,
        // Render selection as a CM layer (not native), so it stays visible when the editor
        // is blurred — e.g. while focus is in the Find widget. Styled to persist below.
        drawSelection(),
        // Required for Cmd+D multi-cursor: CM6 rejects additional selection ranges unless
        // this is on. drawSelection() renders all the cursors; typing edits every range.
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        // Search state + native highlighting. The panel is hidden; we drive it from our
        // own floating FindWidget. Include search() BEFORE the keymap so its state exists.
        search({ createPanel: hiddenSearchPanel }),
        keymap.of([
          { key: 'Mod-s', run: () => { onSaveRef.current(); return true } },
          // Our Cmd+F opens the custom find widget (and the hidden panel behind it). We do
          // NOT spread ...searchKeymap, so CM's default Mod-f panel never appears; the
          // find/replace nav commands are dispatched by the widget instead.
          { key: 'Mod-f', run: () => { openFindRef.current(false); return true } },
          { key: 'Mod-Alt-f', run: () => { openFindRef.current(true); return true } },
          // VS Code selection/line staples not in defaultKeymap. Cmd+D grows a multi-cursor
          // selection per occurrence (Escape collapses via defaultKeymap's simplifySelection).
          { key: 'Mod-d', preventDefault: true, run: selectNextOccurrence },
          { key: 'Mod-l', preventDefault: true, run: selectLine },
          { key: 'Mod-Shift-k', preventDefault: true, run: deleteLine },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
        languageComp.current.of(languageForFilename(filename)),
        themeComp.current.of(editorThemeExtension(themeKey)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            // A doc change we applied ourselves (external value/path sync). Do NOT re-emit
            // onChange — that would feed the new value back to App, which re-renders and
            // re-syncs, looping until the renderer freezes. Consume the flag and stop.
            if (isApplyingExternalUpdateRef.current) {
              isApplyingExternalUpdateRef.current = false
              return
            }
            markActiveRef.current = false
            emitCounterRef.current++ // this render's value prop is now stale
            onChangeRef.current(u.state.doc.toString())
            // Promote a preview tab only on a genuine user edit. Programmatic doc
            // replacement (path swap / value sync) is tagged with ProgrammaticDoc and must
            // NOT count as an edit, or swapping the previewed file would promote it.
            const programmatic = u.transactions.some((t) => t.annotation(ProgrammaticDoc))
            if (!programmatic) onUserEditRef.current?.()
          }
          // Track the last NON-EMPTY user selection so "find in selection" can scope to it
          // even after focus moves to the Find input. Ignore selections created by search
          // navigation (findNext/replace select a match) — those carry a "select.search"
          // userEvent — so the remembered range stays a real user selection.
          if (u.selectionSet) {
            const fromSearch = u.transactions.some((t) => {
              const ue = t.annotation(Transaction.userEvent)
              return ue != null && ue.startsWith('select.search')
            })
            const main = u.state.selection.main
            if (!fromSearch && !main.empty) {
              lastSelectionRef.current = { from: main.from, to: main.to }
            }
            // Report the selection to the status bar (only from the active editor, so a
            // background split pane doesn't clobber the focused pane's status).
            if (activeEditorView === u.view) selectionStatusListener?.(selectionLabel(u.state))
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': {
            fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
            overflow: 'auto',
          },
          // Keep the selection visible when the editor is BLURRED (e.g. focus is in the Find
          // widget). drawSelection() hides .cm-selectionBackground on blur by default; force
          // it to persist (a touch dimmer than the focused selection, like VS Code). The
          // package themes vary, so use !important to win.
          '.cm-selectionBackground': { backgroundColor: 'var(--selection, #27678260) !important' },
          '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection-focused, #276782dd) !important' },
          // Force a persistent (non-overlay) scrollbar. Styling ::-webkit-scrollbar with
          // an explicit width + non-overlay appearance keeps it from fading like the macOS
          // overlay scrollbar. Do NOT also set scrollbar-color — that re-enables overlay.
          '.cm-scroller::-webkit-scrollbar': {
            width: '14px',
            height: '14px',
            WebkitAppearance: 'none',
          },
          '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
          '.cm-scroller::-webkit-scrollbar-thumb': {
            background: 'var(--scrollbar-thumb)',
            borderRadius: '7px',
            border: '3px solid transparent',
            backgroundClip: 'content-box',
            minHeight: '40px',
          },
          '.cm-scroller::-webkit-scrollbar-thumb:hover': {
            background: 'var(--scrollbar-thumb-hover)',
            backgroundClip: 'content-box',
          },
          // Active-line highlight. !important is required to beat the package theme's own
          // .cm-activeLine rule (e.g. oneDark's faint #6699ff0b), which otherwise wins on
          // specificity despite this being declared later.
          '.cm-activeLine': { backgroundColor: 'var(--active-line) !important' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--active-line) !important' },
          // While a selection exists, suppress the active-line background so it doesn't
          // occlude the (behind-content) selection layer — matches VS Code, which hides
          // the current-line highlight during a selection. Higher specificity (&.class
          // descendant) beats the base .cm-activeLine !important rule above.
          '&.cm-has-selection .cm-activeLine': { backgroundColor: 'transparent !important' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    activeEditorView = view
    view.focus() // focus a newly-mounted editor so the user can type immediately
    return () => {
      if (activeEditorView === view) {
        activeEditorView = null
        selectionStatusListener?.('') // closing the active editor → clear the status
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When the open file changes (path), swap document + language, and move focus into the
  // editor so typing works right away after opening/switching a tab (VS Code behavior).
  // Skipped while the Find widget is open, so opening/replacing a preview file mid-search
  // doesn't yank focus out of the find input.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      isApplyingExternalUpdateRef.current = true // suppress the onChange echo for this replace
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        effects: languageComp.current.reconfigure(languageForFilename(filename)),
        annotations: ProgrammaticDoc.of(true), // path swap — not a user edit
      })
    } else {
      view.dispatch({ effects: languageComp.current.reconfigure(languageForFilename(filename)) })
    }
    if (!findOpen) view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Capture the emit counter at render time so the value-sync effect can tell whether the
  // `value` prop it received is already stale (the user typed after this render was queued).
  const renderEmitCount = emitCounterRef.current

  // Sync external value changes (e.g. revert-to-saved) that arrive WITHOUT a path change.
  // Guards against the freeze loop: (1) if the user has typed since this render, the value
  // prop is stale — skip, or we'd clobber the newest keystroke and thrash; (2) if the doc
  // already matches, no-op; (3) otherwise mark it external so the updateListener won't echo.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (emitCounterRef.current !== renderEmitCount) return // stale value from an old render
    const current = view.state.doc.toString()
    if (value === current) return
    isApplyingExternalUpdateRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: ProgrammaticDoc.of(true), // external value sync (e.g. revert) — not a user edit
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Reconfigure the editor theme live when the app theme changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: themeComp.current.reconfigure(editorThemeExtension(themeKey)) })
  }, [themeKey])

  // Jump to a line (1-based) when a search result is clicked. The token lets the same
  // line re-trigger a jump.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !gotoLine) return
    const lineNo = Math.max(1, Math.min(gotoLine.line, view.state.doc.lines))
    const lineInfo = view.state.doc.line(lineNo)
    view.dispatch({
      selection: { anchor: lineInfo.from },
      effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
    })
    view.focus()
  }, [gotoLine?.token])

  return (
    <div class="cm-host-wrap">
      {findOpen && (
        <FindWidget
          query={findQuery}
          replace={findReplace}
          caseSensitive={findCase}
          wholeWord={findWord}
          regexp={findRegex}
          inSelection={findInSelection}
          replaceExpanded={replaceExpanded}
          current={matchState.current}
          total={matchState.total}
          invalid={matchState.invalid}
          onQuery={setFindQuery}
          onReplace={setFindReplace}
          onToggleCase={() => setFindCase((v) => !v)}
          onToggleWord={() => setFindWord((v) => !v)}
          onToggleRegex={() => setFindRegex((v) => !v)}
          onToggleInSelection={toggleInSelection}
          onToggleReplaceExpanded={() => setReplaceExpanded((v) => !v)}
          onNext={runFindNext}
          onPrev={runFindPrev}
          onReplaceOne={runReplaceOne}
          onReplaceAll={runReplaceAll}
          onClose={closeFind}
          onFindKeyDown={onFindKeyDown}
          onReplaceKeyDown={onReplaceKeyDown}
        />
      )}
      <div class="cm-host" ref={hostRef} />
    </div>
  )
}
