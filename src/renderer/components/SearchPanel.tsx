import { useState, useRef, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, CaseSensitive, WholeWord, Regex } from 'lucide-preact'
import type { SearchFileResult, SearchOptions, SearchMatch } from '../../../electron/types'

interface SearchPanelProps {
  onOpenMatch: (filePath: string, fileName: string, line: number) => void
}

export function SearchPanel({ onOpenMatch }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [opts, setOpts] = useState<SearchOptions>({})
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async (q: string, o: SearchOptions) => {
    if (!q) { setResults([]); setTotal(0); setTruncated(false); return }
    setSearching(true)
    try {
      const res = await window.editorApi.search(q, o)
      setResults(res.files)
      setTotal(res.total)
      setTruncated(res.truncated)
    } catch {
      setResults([]); setTotal(0)
    } finally {
      setSearching(false)
    }
  }, [])

  const onQueryInput = (q: string) => {
    setQuery(q)
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

  return (
    <div class="search-panel" data-testid="search-panel">
      <div class="sidebar-header">Search</div>
      <div class="search-input-row">
        <input
          class="search-input"
          placeholder="Search"
          value={query}
          onInput={(e) => onQueryInput((e.target as HTMLInputElement).value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <div class="search-opts">
          <button class={`search-opt${opts.caseSensitive ? ' on' : ''}`} title="Match Case" onClick={() => toggleOpt('caseSensitive')}><CaseSensitive size={15} /></button>
          <button class={`search-opt${opts.wholeWord ? ' on' : ''}`} title="Match Whole Word" onClick={() => toggleOpt('wholeWord')}><WholeWord size={15} /></button>
          <button class={`search-opt${opts.regex ? ' on' : ''}`} title="Use Regular Expression" onClick={() => toggleOpt('regex')}><Regex size={15} /></button>
        </div>
      </div>

      <div class="search-summary">
        {searching ? 'Searching…' :
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
                <MatchRow key={i} m={m} onClick={() => onOpenMatch(fr.path, name, m.line)} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MatchRow({ m, onClick }: { m: SearchMatch; onClick: () => void }) {
  // Render the line with the matched span highlighted, trimming long leading whitespace.
  const lead = m.text.length - m.text.trimStart().length
  const trimAt = Math.min(lead, Math.max(0, m.matchStart - 8))
  const before = m.text.slice(trimAt, m.matchStart)
  const hit = m.text.slice(m.matchStart, m.matchEnd)
  const after = m.text.slice(m.matchEnd)
  return (
    <div class="search-match" onClick={onClick} title={`Line ${m.line}`}>
      <span class="search-match-text">
        {before}<mark>{hit}</mark>{after}
      </span>
    </div>
  )
}
