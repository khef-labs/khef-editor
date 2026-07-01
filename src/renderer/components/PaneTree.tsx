import { Fragment } from 'preact'
import { useRef } from 'preact/hooks'
import { EditorGroupView } from './EditorGroupView'
import type { LayoutNode, LeafNode, SplitNode, OpenTab } from '../lib/layout'

interface PaneTreeProps {
  node: LayoutNode
  activeLeafId: string
  themeId: string
  gotoLine?: { path: string; line: number; token: number } | null
  onFocus: (leafId: string) => void
  onActivateTab: (leafId: string, path: string) => void
  onCloseTab: (leafId: string, path: string) => void
  onChangeContent: (leafId: string, path: string, content: string) => void
  onUserEdit: (leafId: string, path: string) => void
  onPromoteTab: (leafId: string, path: string) => void
  onSave: (leafId: string, path: string) => void
  onResize: (splitId: string, sizes: number[]) => void
  onOpenFolder?: () => void
  onOpenFile?: () => void
  onOpenSettings?: () => void
  recentFolders?: string[]
  onOpenRecent?: (dir: string) => void
}

// Per-pane minimum size in px. Below this, panes stop shrinking and the editor area
// scrolls (VS Code behavior with many splits).
const MIN_PANE = 220

export function PaneTree(props: PaneTreeProps) {
  const { node } = props
  if (node.kind === 'leaf') {
    return <Leaf {...props} leaf={node} />
  }
  return <Split {...props} split={node} />
}

function Split({ split, ...props }: PaneTreeProps & { split: SplitNode }) {
  const isRow = split.orientation === 'row'
  const minProp = isRow ? 'minWidth' : 'minHeight'

  return (
    <div class={`pane-split pane-${split.orientation}`}>
      {split.children.map((child, i) => (
        <Fragment key={(child as LayoutNode & { id: string }).id}>
          {i > 0 && (
            <Divider
              orientation={split.orientation}
              onDrag={(deltaFrac) => {
                // Adjust the boundary between child i-1 and i.
                const sizes = [...split.sizes]
                const min = 0.05
                let left = sizes[i - 1] + deltaFrac
                let right = sizes[i] - deltaFrac
                if (left < min) { right += left - min; left = min }
                if (right < min) { left += right - min; right = min }
                sizes[i - 1] = left
                sizes[i] = right
                props.onResize(split.id, sizes)
              }}
            />
          )}
          <div class="pane-cell" style={{ flex: `${split.sizes[i]} 1 0`, [minProp]: `${MIN_PANE}px` }}>
            <PaneTree {...props} node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

interface DividerProps {
  orientation: 'row' | 'column'
  onDrag: (deltaFraction: number) => void
}

function Divider({ orientation, onDrag }: DividerProps) {
  const isRow = orientation === 'row'
  const startRef = useRef(0)
  const extentRef = useRef(1)

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const parent = target.parentElement
    const rect = parent?.getBoundingClientRect()
    extentRef.current = (isRow ? rect?.width : rect?.height) || 1
    startRef.current = isRow ? e.clientX : e.clientY

    const onMove = (ev: PointerEvent) => {
      const pos = isRow ? ev.clientX : ev.clientY
      const deltaPx = pos - startRef.current
      startRef.current = pos
      onDrag(deltaPx / extentRef.current)
    }
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  return (
    <div
      class={`pane-divider pane-divider-${orientation}`}
      onPointerDown={onPointerDown}
      data-testid="pane-divider"
    />
  )
}

function Leaf({ leaf, activeLeafId, themeId, gotoLine, onFocus, onActivateTab, onCloseTab, onChangeContent, onUserEdit, onPromoteTab, onSave, onOpenFolder, onOpenFile, onOpenSettings, recentFolders, onOpenRecent }:
  PaneTreeProps & { leaf: LeafNode }) {
  const group = { id: leaf.id, tabs: leaf.tabs as OpenTab[], activePath: leaf.activePath }
  return (
    <EditorGroupView
      group={group}
      isFocused={leaf.id === activeLeafId}
      themeId={themeId}
      gotoLine={gotoLine}
      onFocus={() => onFocus(leaf.id)}
      onActivateTab={(path) => onActivateTab(leaf.id, path)}
      onCloseTab={(path) => onCloseTab(leaf.id, path)}
      onChangeContent={(path, content) => onChangeContent(leaf.id, path, content)}
      onUserEdit={(path) => onUserEdit(leaf.id, path)}
      onPromoteTab={(path) => onPromoteTab(leaf.id, path)}
      onSave={(path) => onSave(leaf.id, path)}
      onOpenFolder={onOpenFolder}
      onOpenFile={onOpenFile}
      onOpenSettings={onOpenSettings}
      recentFolders={recentFolders}
      onOpenRecent={onOpenRecent}
    />
  )
}
