import { useEffect, useRef, useState } from 'preact/hooks'
import { X, Circle, Eye, SquareSplitHorizontal, Ellipsis } from 'lucide-preact'
import { isPreviewable } from '../lib/preview'
import type { OpenTab } from '../lib/editorGroups'

export type { OpenTab }

interface TabBarProps {
  tabs: OpenTab[]
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  // Double-clicking an ephemeral (preview) tab promotes it to a permanent tab.
  onPromote: (path: string) => void
  // Right-click → tab context menu (position taken from the mouse event).
  onContextMenu: (path: string, e: MouseEvent) => void
  // Title-bar actions (right side of the tab row), acting on the ACTIVE tab.
  onPreview: () => void
  onSplitRight: () => void
  onMore: (e: MouseEvent) => void
  // Drag-reorder within this bar: move `path` to insertion gap `toGap` (0..tabs.length,
  // counted in the pre-removal order — see lib/tabOrder.ts).
  onReorder: (path: string, toGap: number) => void
}

export function TabBar({ tabs, activePath, onActivate, onClose, onPromote, onContextMenu, onPreview, onSplitRight, onMore, onReorder }: TabBarProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  // Path of the tab being dragged. A ref (not dataTransfer) so drags from other windows
  // or apps can never trigger a reorder; null means no drag from this bar is active.
  const dragPathRef = useRef<string | null>(null)
  // Insertion gap the drop would use, for the indicator line; null hides it.
  const [dropGap, setDropGap] = useState<number | null>(null)

  // Gap index for a dragover at clientX over tab i: before it on the left half, after
  // it on the right half.
  const gapAt = (i: number, e: DragEvent): number => {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? i : i + 1
  }

  const endDrag = () => { dragPathRef.current = null; setDropGap(null) }

  // Keep the active tab visible. The strip scrolls horizontally with no scrollbar, so a
  // tab activated by anything other than a click on it (ke <path>, Cmd+P, Explorer,
  // tab cycling) could land off-screen. Runs after paint so the new tab's DOM exists.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || !activePath) return
    const el = Array.from(strip.children).find((c) => (c as HTMLElement).dataset.path === activePath) as HTMLElement | undefined
    if (!el) return
    const left = el.offsetLeft
    const right = left + el.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
  }, [activePath, tabs.length])

  if (tabs.length === 0) return null
  const active = tabs.find((t) => t.path === activePath) ?? null
  const isEditorTab = !!active && (active.kind === undefined || active.kind === 'editor')
  const canPreview = isEditorTab && !!active && isPreviewable(active.name)
  return (
    <div class="tabbar" data-testid="tabbar">
      <div
        class="tabbar-tabs"
        ref={stripRef}
        onDragOver={(e) => {
          // Dragging past the last tab into the strip's empty space drops at the end.
          if (!dragPathRef.current) return
          e.preventDefault()
          if (e.target === stripRef.current) setDropGap(tabs.length)
        }}
        onDrop={(e) => {
          if (!dragPathRef.current) return
          e.preventDefault()
          if (dropGap !== null) onReorder(dragPathRef.current, dropGap)
          endDrag()
        }}
        onDragLeave={(e) => {
          // Only clear when leaving the strip entirely, not when crossing between tabs.
          const to = e.relatedTarget as Node | null
          if (!to || !stripRef.current?.contains(to)) setDropGap(null)
        }}
      >
        {tabs.map((t, i) => {
          const dirty = t.content !== t.savedContent
          const active = t.path === activePath
          const dropClass = dropGap === i ? ' drop-before' : dropGap === i + 1 && i === tabs.length - 1 ? ' drop-after' : ''
          return (
            <div
              key={t.path}
              class={`tab${active ? ' active' : ''}${t.ephemeral ? ' ephemeral' : ''}${dropClass}`}
              draggable
              onDragStart={(e) => {
                dragPathRef.current = t.path
                if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.path) }
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!dragPathRef.current) return
                e.preventDefault()
                e.stopPropagation()
                setDropGap(gapAt(i, e))
              }}
              onClick={() => onActivate(t.path)}
              onDblClick={() => onPromote(t.path)}
              onContextMenu={(e) => { e.preventDefault(); onContextMenu(t.path, e) }}
              data-testid={`tab-${t.name}`}
              data-path={t.path}
            >
              <span class="tab-name">{t.name}</span>
              <span
                class="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.path)
                }}
              >
                {dirty ? <Circle size={9} fill="currentColor" /> : <X size={13} />}
              </span>
            </div>
          )
        })}
      </div>
      <div class="tabbar-actions">
        <button class="tabbar-action" title="Open Preview to the Side" disabled={!canPreview} onClick={onPreview}>
          <Eye size={16} />
        </button>
        <button class="tabbar-action" title="Split Editor Right" disabled={!active} onClick={onSplitRight}>
          <SquareSplitHorizontal size={16} />
        </button>
        <button class="tabbar-action" title="More Actions…" disabled={!active} onClick={(e) => onMore(e)}>
          <Ellipsis size={16} />
        </button>
      </div>
    </div>
  )
}
