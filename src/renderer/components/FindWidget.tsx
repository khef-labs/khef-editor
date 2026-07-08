import { useEffect, useRef } from 'preact/hooks'
import {
  CaseSensitive, WholeWord, Regex, ArrowUp, ArrowDown, TextSelect, X,
  ChevronDown, ChevronRight, Replace, ReplaceAll,
} from 'lucide-preact'
import { MAX_MATCHES } from '../lib/findMatches'

// Presentational VS Code-style find/replace widget. All state + behavior live in
// CodeEditor (which owns the EditorView); this component is dumb and just renders.
export interface FindWidgetProps {
  query: string
  replace: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
  inSelection: boolean
  replaceExpanded: boolean
  current: number
  total: number
  invalid: boolean
  onQuery: (v: string) => void
  onReplace: (v: string) => void
  onToggleCase: () => void
  onToggleWord: () => void
  onToggleRegex: () => void
  onToggleInSelection: () => void
  onToggleReplaceExpanded: () => void
  onNext: () => void
  onPrev: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
  // Enter/Shift+Enter/Escape handling is routed up so CM commands run.
  onFindKeyDown: (e: KeyboardEvent) => void
  onReplaceKeyDown: (e: KeyboardEvent) => void
}

function countLabel(query: string, current: number, total: number, invalid: boolean): string {
  if (query.length === 0) return ''
  if (invalid) return 'Invalid regex'
  if (total === 0) return 'No results'
  const totalStr = total >= MAX_MATCHES ? `${MAX_MATCHES}+` : String(total)
  return current > 0 ? `${current} of ${totalStr}` : `${totalStr} found`
}

export function FindWidget(props: FindWidgetProps) {
  const {
    query, replace, caseSensitive, wholeWord, regexp, inSelection, replaceExpanded,
    current, total, invalid,
    onQuery, onReplace, onToggleCase, onToggleWord, onToggleRegex, onToggleInSelection,
    onToggleReplaceExpanded, onNext, onPrev, onReplaceOne, onReplaceAll, onClose,
    onFindKeyDown, onReplaceKeyDown,
  } = props

  const findInputRef = useRef<HTMLInputElement>(null)

  // Focus + select the find input when the widget mounts.
  useEffect(() => {
    const el = findInputRef.current
    if (el) { el.focus(); el.select() }
  }, [])

  const noMatches = total === 0 || invalid || query.length === 0
  const label = countLabel(query, current, total, invalid)

  return (
    <div class="cm-find-widget" data-testid="find-widget" onMouseDown={(e) => e.stopPropagation()}>
      <button
        class="find-expander"
        title={replaceExpanded ? 'Hide Replace' : 'Show Replace'}
        onClick={onToggleReplaceExpanded}
        tabIndex={-1}
      >
        {replaceExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
      </button>

      <div class="find-rows">
        <div class="find-row">
          <div class={`find-input-wrap${invalid ? ' invalid' : ''}`}>
            <input
              ref={findInputRef}
              class="find-input"
              type="text"
              placeholder="Find"
              value={query}
              spellcheck={false}
              onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
              onKeyDown={onFindKeyDown}
              data-testid="find-input"
            />
            <div class="find-toggles">
              <button class={`find-toggle${caseSensitive ? ' active' : ''}`} title="Match Case" onClick={onToggleCase} tabIndex={-1}>
                <CaseSensitive size={20} />
              </button>
              <button class={`find-toggle${wholeWord ? ' active' : ''}`} title="Match Whole Word" onClick={onToggleWord} tabIndex={-1}>
                <WholeWord size={20} />
              </button>
              <button class={`find-toggle${regexp ? ' active' : ''}`} title="Use Regular Expression" onClick={onToggleRegex} tabIndex={-1}>
                <Regex size={20} />
              </button>
            </div>
          </div>

          <span class="find-count" data-testid="find-count">{label}</span>

          <div class="find-actions">
            <button class="find-btn" title="Previous Match (⇧⏎)" onClick={onPrev} disabled={noMatches} tabIndex={-1}>
              <ArrowUp size={20} />
            </button>
            <button class="find-btn" title="Next Match (⏎)" onClick={onNext} disabled={noMatches} tabIndex={-1}>
              <ArrowDown size={20} />
            </button>
            <button class={`find-btn${inSelection ? ' active' : ''}`} title="Find in Selection" onClick={onToggleInSelection} tabIndex={-1}>
              <TextSelect size={20} />
            </button>
            <button class="find-btn" title="Close (Esc)" onClick={onClose} tabIndex={-1}>
              <X size={20} />
            </button>
          </div>
        </div>

        {replaceExpanded && (
          <div class="find-row replace-row">
            <div class="find-input-wrap">
              <input
                class="find-input"
                type="text"
                placeholder="Replace"
                value={replace}
                spellcheck={false}
                onInput={(e) => onReplace((e.target as HTMLInputElement).value)}
                onKeyDown={onReplaceKeyDown}
                data-testid="replace-input"
              />
              <div class="find-toggles">
                {/* Preserve Case (AB) is deferred — CM replace has no case-preservation.
                    Disabled with a tooltip until a follow-up implements it. */}
                <button class="find-toggle" title="Preserve Case (coming soon)" disabled tabIndex={-1}>
                  <span class="find-glyph">AB</span>
                </button>
              </div>
            </div>
            <div class="find-actions">
              <button class="find-btn" title="Replace (⏎)" onClick={onReplaceOne} disabled={noMatches} tabIndex={-1}>
                <Replace size={20} />
              </button>
              <button class="find-btn" title="Replace All" onClick={onReplaceAll} disabled={noMatches} tabIndex={-1}>
                <ReplaceAll size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
