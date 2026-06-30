// N-ary split-tree layout for panes (VS Code-style). A node is either a leaf (one
// editor) or a split with an orientation and an array of children. Splitting a leaf
// whose parent is already the same orientation adds an EQUAL sibling to that split
// (so panes stay even, like VS Code) rather than nesting binary splits.

export interface OpenTab {
  path: string
  name: string
  content: string
  savedContent: string
  // True for files opened via "Open File" outside the workspace root. These save back
  // through the per-file loose-write gate, not the workspace-confined write.
  loose?: boolean
  // 'editor' (default) shows the CodeMirror editor; 'preview' renders the source file as
  // Markdown/Mermaid; 'diff' shows a read-only side-by-side git diff. preview/diff tabs use
  // a synthetic path so they're distinct from the editor tab.
  kind?: 'editor' | 'preview' | 'diff'
  sourcePath?: string
  // For diff tabs: the diff spec (mode/file/hash).
  diff?: { mode: 'working' | 'commit'; file: string; hash?: string }
}

export interface LeafNode {
  kind: 'leaf'
  id: string
  tabs: OpenTab[]
  activePath: string | null
}

export interface SplitNode {
  kind: 'split'
  id: string
  orientation: 'row' | 'column'
  children: LayoutNode[] // length >= 2
  sizes: number[]        // same length as children, sums to ~1
}

export type LayoutNode = LeafNode | SplitNode

let seq = 0
function nextId(prefix: string): string {
  return `${prefix}${++seq}`
}

export function makeLeaf(tabs: OpenTab[] = [], activePath: string | null = null): LeafNode {
  return { kind: 'leaf', id: nextId('leaf'), tabs, activePath }
}

function equalSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

export function leaves(node: LayoutNode): LeafNode[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(leaves)
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  for (const l of leaves(node)) if (l.id === id) return l
  return null
}

// Map every leaf, returning a new tree.
export function mapLeaves(node: LayoutNode, fn: (leaf: LeafNode) => LeafNode): LayoutNode {
  if (node.kind === 'leaf') return fn(node)
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)) }
}

// Update one leaf (by id), returning a new tree.
export function updateLeaf(node: LayoutNode, id: string, fn: (leaf: LeafNode) => LeafNode): LayoutNode {
  if (node.kind === 'leaf') return node.id === id ? fn(node) : node
  return { ...node, children: node.children.map((c) => updateLeaf(c, id, fn)) }
}

// Update a split's sizes (by split id).
export function setSplitSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (node.kind === 'leaf') return node
  if (node.id === splitId) return { ...node, sizes }
  return { ...node, children: node.children.map((c) => setSplitSizes(c, splitId, sizes)) }
}

// Internal: produce the replacement node for a leaf being split, given the new sibling
// and orientation. If `parentOrientation` matches, the caller handles sibling insertion;
// this only builds the wrapped split used when orientations differ.
function wrapSplit(leaf: LeafNode, dup: LeafNode, orientation: 'row' | 'column'): SplitNode {
  return {
    kind: 'split',
    id: nextId('split'),
    orientation,
    children: [leaf, dup],
    sizes: equalSizes(2),
  }
}

// Split a leaf, duplicating its active tab. Returns { tree, newLeafId } or null when
// the leaf has no active tab. When the leaf's parent split already has the requested
// orientation, the new pane is inserted as an EQUAL sibling next to it (no nesting);
// otherwise the leaf is wrapped in a new split.
export function splitLeaf(
  tree: LayoutNode,
  leafId: string,
  orientation: 'row' | 'column',
): { tree: LayoutNode; newLeafId: string } | null {
  const leaf = findLeaf(tree, leafId)
  if (!leaf || !leaf.activePath) return null
  const tab = leaf.tabs.find((t) => t.path === leaf.activePath)
  if (!tab) return null
  const dup = makeLeaf([{ ...tab }], tab.path)

  // Root is the leaf itself → wrap.
  if (tree.kind === 'leaf') {
    if (tree.id !== leafId) return null
    return { tree: wrapSplit(tree, dup, orientation), newLeafId: dup.id }
  }

  const next = insertSplit(tree, leafId, dup, orientation)
  return next ? { tree: next, newLeafId: dup.id } : null
}

// Like splitLeaf, but the new pane contains the given tab (e.g. a preview) instead of a
// duplicate of the active editor.
export function splitLeafWithTab(
  tree: LayoutNode,
  leafId: string,
  orientation: 'row' | 'column',
  newTab: OpenTab,
): { tree: LayoutNode; newLeafId: string } | null {
  const leaf = findLeaf(tree, leafId)
  if (!leaf) return null
  const newLeaf = makeLeaf([newTab], newTab.path)

  if (tree.kind === 'leaf') {
    if (tree.id !== leafId) return null
    return { tree: wrapSplit(tree, newLeaf, orientation), newLeafId: newLeaf.id }
  }
  const next = insertSplit(tree, leafId, newLeaf, orientation)
  return next ? { tree: next, newLeafId: newLeaf.id } : null
}

// Recursively find the parent split of `leafId` and either add an equal sibling (same
// orientation) or replace the leaf with a wrapped split (different orientation).
function insertSplit(
  split: SplitNode,
  leafId: string,
  dup: LeafNode,
  orientation: 'row' | 'column',
): SplitNode | null {
  const idx = split.children.findIndex((c) => c.kind === 'leaf' && c.id === leafId)
  if (idx >= 0) {
    const leaf = split.children[idx] as LeafNode
    if (split.orientation === orientation) {
      // Same orientation → insert equal sibling right after the leaf.
      const children = [...split.children]
      children.splice(idx + 1, 0, dup)
      return { ...split, children, sizes: equalSizes(children.length) }
    }
    // Different orientation → wrap this leaf in a nested split.
    const wrapped = wrapSplit(leaf, dup, orientation)
    const children = [...split.children]
    children[idx] = wrapped
    return { ...split, children } // sizes unchanged (same count)
  }
  // Recurse into child splits.
  const children = [...split.children]
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (c.kind === 'split') {
      const res = insertSplit(c, leafId, dup, orientation)
      if (res) {
        children[i] = res
        return { ...split, children }
      }
    }
  }
  return null
}

// Remove a leaf (C-x 0). Its slot is dropped; a split with one remaining child
// collapses into that child. Returns { tree, focusId } or null if the leaf was the
// only pane (caller keeps it).
export function removeLeaf(tree: LayoutNode, leafId: string): { tree: LayoutNode; focusId: string } | null {
  if (tree.kind === 'leaf') {
    return tree.id === leafId ? null : { tree, focusId: tree.id }
  }
  const res = removeFromSplit(tree, leafId)
  if (!res) return { tree, focusId: leaves(tree)[0].id } // not found → unchanged
  return res
}

function removeFromSplit(split: SplitNode, leafId: string): { tree: LayoutNode; focusId: string } | null {
  const idx = split.children.findIndex((c) => c.kind === 'leaf' && c.id === leafId)
  if (idx >= 0) {
    const children = split.children.filter((_, i) => i !== idx)
    const sizes = equalSizes(children.length)
    // Pick a focus: the sibling that took this slot (or the new last).
    const focusTarget = children[Math.min(idx, children.length - 1)]
    const focusId = leaves(focusTarget)[0].id
    if (children.length === 1) {
      return { tree: children[0], focusId } // collapse single-child split
    }
    return { tree: { ...split, children, sizes }, focusId }
  }
  // Recurse.
  const children = [...split.children]
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (c.kind === 'split') {
      const res = removeFromSplit(c, leafId)
      if (res) {
        children[i] = res.tree
        return { tree: { ...split, children }, focusId: res.focusId }
      }
    }
  }
  return null
}

// C-x 1: replace the whole tree with just the focused leaf.
export function soloLeaf(tree: LayoutNode, leafId: string): LayoutNode {
  const leaf = findLeaf(tree, leafId)
  return leaf ?? tree
}
