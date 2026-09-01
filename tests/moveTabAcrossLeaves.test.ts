import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveTabAcrossLeaves, findLeaf, leaves } from '../src/renderer/lib/layout.ts'
import type { LayoutNode, LeafNode, OpenTab } from '../src/renderer/lib/layout.ts'

function tab(path: string): OpenTab {
  return { path, name: path, content: '', savedContent: '' }
}

function leaf(id: string, paths: string[], activePath: string | null = paths[0] ?? null): LeafNode {
  return { kind: 'leaf', id, tabs: paths.map(tab), activePath }
}

function row(...children: LeafNode[]): LayoutNode {
  return { kind: 'split', id: 'root', orientation: 'row', children, sizes: children.map(() => 1 / children.length) }
}

const order = (l: LeafNode | null) => l?.tabs.map((t) => t.path).join('') ?? '(gone)'

test('moves a tab into the destination gap and activates it', () => {
  const tree = row(leaf('A', ['a', 'b']), leaf('B', ['x', 'y']))
  const res = moveTabAcrossLeaves(tree, 'A', 'b', 'B', 1)
  assert.ok(res)
  assert.equal(order(findLeaf(res.tree, 'A')), 'a')
  const dst = findLeaf(res.tree, 'B')
  assert.equal(order(dst), 'xby')
  assert.equal(dst?.activePath, 'b')
  assert.equal(res.focusId, 'B')
})

test('source picks a neighbor active tab when its active tab moves away', () => {
  const tree = row(leaf('A', ['a', 'b', 'c'], 'b'), leaf('B', ['x']))
  const res = moveTabAcrossLeaves(tree, 'A', 'b', 'B', 0)
  assert.ok(res)
  assert.equal(findLeaf(res.tree, 'A')?.activePath, 'c')
})

test('collapses the source pane when the move empties it', () => {
  const tree = row(leaf('A', ['only']), leaf('B', ['x']))
  const res = moveTabAcrossLeaves(tree, 'A', 'only', 'B', 2)
  assert.ok(res)
  assert.equal(findLeaf(res.tree, 'A'), null)
  assert.equal(leaves(res.tree).length, 1)
  assert.equal(order(findLeaf(res.tree, 'B')), 'xonly')
})

test('merges with an existing duplicate in the destination instead of doubling it', () => {
  const tree = row(leaf('A', ['dup', 'b']), leaf('B', ['dup', 'x'], 'x'))
  const res = moveTabAcrossLeaves(tree, 'A', 'dup', 'B', 2)
  assert.ok(res)
  assert.equal(order(findLeaf(res.tree, 'A')), 'b')
  const dst = findLeaf(res.tree, 'B')
  assert.equal(order(dst), 'dupx')
  assert.equal(dst?.activePath, 'dup')
})

test('rejects same-leaf moves and unknown tabs', () => {
  const tree = row(leaf('A', ['a']), leaf('B', ['x']))
  assert.equal(moveTabAcrossLeaves(tree, 'A', 'a', 'A', 0), null)
  assert.equal(moveTabAcrossLeaves(tree, 'A', 'zzz', 'B', 0), null)
  assert.equal(moveTabAcrossLeaves(tree, 'nope', 'a', 'B', 0), null)
})
