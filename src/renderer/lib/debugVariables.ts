// Planning + assembly for fetching a debug variable node's children, split out from the
// DebugPanel component so it's unit-testable without a DOM. DAP collections (arrays,
// hashes) split their contents: an adapter like rdbg returns the ELEMENTS only for a
// `filter:'indexed'` request and the NAMED members (e.g. #class) only for a named/plain
// request. A plain fetch of such a node therefore shows metadata but none of the elements —
// which is the bug this fixes.

export interface VarNode {
  variablesReference: number
  indexedVariables?: number
  namedVariables?: number
}

export interface VarChild {
  name: string
  value: string
  variablesReference: number
}

// Cap on indexed elements pulled for one collection, so a huge container can't flood the
// panel. VS Code paginates; this is a simpler ceiling with a trailing "N more" marker.
export const MAX_INDEXED = 1000

export interface VarRequest { ref: number; filter?: 'indexed' | 'named'; start?: number; count?: number }

// The request(s) needed to list a node's children. A non-collection is a single plain
// request; a collection is a named request (only if it has named members) followed by an
// indexed page. Order matters: named children render before elements.
export function childRequests(node: VarNode): VarRequest[] {
  const idx = node.indexedVariables ?? 0
  if (idx <= 0) return [{ ref: node.variablesReference }]
  const reqs: VarRequest[] = []
  if ((node.namedVariables ?? 0) > 0) reqs.push({ ref: node.variablesReference, filter: 'named', start: 0, count: node.namedVariables })
  reqs.push({ ref: node.variablesReference, filter: 'indexed', start: 0, count: Math.min(idx, MAX_INDEXED) })
  return reqs
}

// Concatenate the per-request results in order, appending a truncation marker when the
// collection has more indexed elements than we pulled.
export function assembleChildren(node: VarNode, results: VarChild[][]): VarChild[] {
  const shown = results.flat()
  const idx = node.indexedVariables ?? 0
  if (idx > MAX_INDEXED) shown.push({ name: '…', value: `${idx - MAX_INDEXED} more elements`, variablesReference: 0 })
  return shown
}
