import { useEffect, useRef } from 'preact/hooks'

// Generic VS Code-style context menu. Purely presentational: callers supply position and
// entries; the menu closes itself on outside click, Escape, window blur, or resize.
// Rendered as a fixed overlay; position is clamped into the viewport after first paint.
export type MenuEntry =
  | { kind: 'item'; label: string; hint?: string; disabled?: boolean; onClick: () => void }
  | { kind: 'separator' }

interface ContextMenuProps {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, entries, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Dismissal: any mousedown outside the menu (capture phase so nothing swallows it),
  // Escape, window blur, or resize.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    const dismiss = () => onClose()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [onClose])

  // Clamp into the viewport once rendered (menu size isn't known until after layout).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`
  }, [x, y])

  return (
    <div class="context-menu" ref={ref} style={{ left: x, top: y }} data-testid="context-menu">
      {entries.map((entry, i) =>
        entry.kind === 'separator' ? (
          <div class="context-menu-sep" key={i} />
        ) : (
          <button
            key={i}
            class="context-menu-item"
            disabled={entry.disabled}
            onClick={() => { onClose(); entry.onClick() }}
          >
            <span class="context-menu-label">{entry.label}</span>
            {entry.hint && <span class="context-menu-hint">{entry.hint}</span>}
          </button>
        ),
      )}
    </div>
  )
}
