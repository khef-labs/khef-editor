import { useState, useRef, useCallback } from 'preact/hooks'
import {
  ChevronRight, ChevronDown, CaseSensitive, WholeWord, Regex,
  ReplaceAll, RefreshCw, ListX, FoldVertical,
} from 'lucide-preact'
import type { SearchFileResult, SearchOptions, SearchMatch } from '../../../electron/types'

interface SearchPanelProps {
  onOpenMatch: (filePath: string, fileName: string, line: number) => void
}

export function SearchPanel({ onOpenMatch }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [opts, setOpts] = useState<SearchOptions>({})
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async (q: string, o: SearchOptions) => {
    if (!q) { setResults([]); setTotal(0); setTruncated(false); return }
    setSearching(true)
    try {
      const res = await window.editorApi.search(q, o)
      setResults(res.files)
      setTotal(res.total)
      setTruncated(res.truncated)
      setCollapsed(new Set())
    } catch {
      setResults([]); setTotal(0)
    } finally {
      setSearching(false)
    }
  }, [])

  const onQueryInput = (q: string) => {
    setQuery(q)
    setNotice(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(q, opts), 200)
  }

  const toggleOpt = (key: keyof SearchOptions) => {
    const next = { ...opts, [key]: !opts[key] }
    setOpts(next)
    void runSearch(query, next)
  }

  const toggleCollapse = (file: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file); else next.add(file)
      return next
    })
  }

  const collapseAll = () => setCollapsed(new Set(results.map((r) => r.file)))

  const replaceAll = async () => {
    if (!query || results.length === 0) return
    setNotice(null)
    try {
      const res = await window.editorApi.replaceAll(query, replacement, opts)
      setNotice(`Replaced ${res.replacements} occurrence${res.replacements === 1 ? '' : 's'} in ${res.filesChanged} file${res.filesChanged === 1 ? '' : 's'}`)
      void runSearch(query, opts) // refresh results
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Replace failed')
    }
  }

  return (
    <div class="search-panel" data-testid="search-panel">
      <div class="search-toolbar">
        <span class="sidebar-header search-title">Search</span>
        <span class="search-toolbar-actions">
          <button class="search-tool" title="Refresh" onClick={() => void runSearch(query, opts)}><RefreshCw size={18} /></button>
          <button class="search-tool" title="Clear Search Results" onClick={() => { setQuery(''); setResults([]); setTotal(0); setNotice(null) }}><ListX size={18} /></button>
          <button class="search-tool" title="Collapse All" onClick={collapseAll}><FoldVertical size={18} /></button>
        </span>
      </div>

      <div class="search-body">
        <button
          class="search-replace-toggle"
          title={showReplace ? 'Hide Replace' : 'Toggle Replace'}
          onClick={() => setShowReplace((v) => !v)}
        >
          {showReplace ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        <div class="search-fields">
          <div class="search-field">
            <input
              class="search-input"
              placeholder="Search"
              value={query}
              onInput={(e) => onQueryInput((e.target as HTMLInputElement).value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <div class="field-toggles">
              <button class={`field-toggle${opts.caseSensitive ? ' on' : ''}`} title="Match Case" onClick={() => toggleOpt('caseSensitive')}><CaseSensitive size={18} /></button>
              <button class={`field-toggle${opts.wholeWord ? ' on' : ''}`} title="Match Whole Word" onClick={() => toggleOpt('wholeWord')}><WholeWord size={18} /></button>
              <button class={`field-toggle${opts.regex ? ' on' : ''}`} title="Use Regular Expression" onClick={() => toggleOpt('regex')}><Regex size={18} /></button>
            </div>
          </div>

          {showReplace && (
            <div class="search-replace-row">
              <div class="search-field">
                <input
                  class="search-input"
                  placeholder="Replace"
                  value={replacement}
                  onInput={(e) => setReplacement((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.altKey)) void replaceAll() }}
                />
              </div>
              <button class="replace-all-btn" title="Replace All" disabled={!query || results.length === 0} onClick={() => void replaceAll()}>
                <ReplaceAll size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div class="search-summary">
        {notice ? <span class="search-notice">{notice}</span> :
          searching ? 'Searching…' :
          total > 0 ? `${total} result${total === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}` :
          query ? 'No results' : ''}
      </div>

      <div class="search-results">
        {results.map((fr) => {
          const isCollapsed = collapsed.has(fr.file)
          const name = fr.file.split('/').pop() ?? fr.file
          const dir = fr.file.slice(0, fr.file.length - name.length - 1)
          return (
            <div key={fr.file} class="search-file">
              <div class="search-file-header" onClick={() => toggleCollapse(fr.file)}>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span class="search-file-name">{name}</span>
                {dir && <span class="search-file-dir">{dir}</span>}
                <span class="search-file-count">{fr.matches.length}</span>
              </div>
              {!isCollapsed && fr.matches.map((m, i) => (
                <MatchRow key={i} m={m} replacement={showReplace ? replacement : null} onClick={() => onOpenMatch(fr.path, name, m.line)} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MatchRow({ m, replacement, onClick }: { m: SearchMatch; replacement: string | null; onClick: () => void }) {
  const trimAt = Math.max(0, m.matchStart - 8)
  const before = m.text.slice(trimAt, m.matchStart)
  const hit = m.text.slice(m.matchStart, m.matchEnd)
  const after = m.text.slice(m.matchEnd)
  return (
    <div class="search-match" onClick={onClick} title={`Line ${m.line}`}>
      <span class="search-match-text">
        {before}
        {replacement !== null ? (
          <>
            <span class="match-old">{hit}</span>
            <span class="match-new">{replacement}</span>
          </>
        ) : (
          <mark>{hit}</mark>
        )}
        {after}
      </span>
    </div>
  )
}
