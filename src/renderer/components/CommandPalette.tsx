import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { fuzzyMatch } from '../lib/fuzzy'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  disabled?: boolean
  run: () => void
}

export function CommandPalette({ commands, onClose, placeholder = 'Search commands…' }: { commands: PaletteCommand[]; onClose: () => void; placeholder?: string }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => commands.map((command) => ({ command, match: fuzzyMatch(query, command.label) }))
    .filter((item) => item.match)
    .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0)), [commands, query])

  useEffect(() => { setSelected(0) }, [query])
  const choose = useCallback((index: number) => {
    const command = results[index]?.command
    if (!command || command.disabled) return
    onClose()
    command.run()
  }, [results, onClose])

  return <div class="qo-backdrop" onMouseDown={onClose}>
    <div class="qo-panel" data-testid="command-palette" onMouseDown={(e) => e.stopPropagation()}>
      <input ref={inputRef} class="qo-input" placeholder={placeholder} value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); choose(selected) }
        }} />
      <ul class="qo-results">
        {results.length === 0 && <li class="qo-empty">No matching commands</li>}
        {results.map(({ command }, index) => <li key={command.id}
          class={`qo-item${index === selected ? ' selected' : ''}${command.disabled ? ' disabled' : ''}`}
          onMouseEnter={() => setSelected(index)} onClick={() => choose(index)}>
          <span class="qo-name">{command.label}</span>
          {command.hint && <span class="qo-dir">{command.hint}</span>}
        </li>)}
      </ul>
    </div>
  </div>
}
