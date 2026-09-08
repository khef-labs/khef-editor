// Local review notes: a comment pinned to one line of one side of one diff. Notes live in
// the app settings file keyed by repository root (never in the repo), and can be exported
// as Markdown for a PR description or a khef memory. Pure functions here; persistence and
// the live store are in reviewNotesStore.ts.

export interface ReviewNote {
  id: string
  // What was being diffed: `commit:<hash>`, `range:<mergeBase>`, `working:` or `staged:`
  // — mirrors DiffSpec so a note re-anchors to the same view.
  ref: string
  file: string
  // 'old' = left/original side, 'new' = right/current side (the only side in unified mode).
  side: 'old' | 'new'
  line: number
  text: string
  createdAt: string
  updatedAt?: string
}

export interface NoteRef { mode: 'working' | 'staged' | 'commit' | 'range'; hash?: string }

export function noteRef(spec: NoteRef): string {
  return `${spec.mode}:${spec.mode === 'commit' || spec.mode === 'range' ? (spec.hash ?? '') : ''}`
}

// Inverse of noteRef, for opening the diff a note belongs to.
export function parseNoteRef(ref: string): NoteRef | null {
  const i = ref.indexOf(':')
  if (i < 0) return null
  const mode = ref.slice(0, i)
  const hash = ref.slice(i + 1)
  if (mode === 'working' || mode === 'staged') return { mode }
  if ((mode === 'commit' || mode === 'range') && hash) return { mode, hash }
  return null
}

export function newNoteId(now: number = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function addNote(notes: ReviewNote[], note: ReviewNote): ReviewNote[] {
  return [...notes, note]
}

export function updateNote(notes: ReviewNote[], id: string, text: string, now: string = new Date().toISOString()): ReviewNote[] {
  return notes.map((n) => (n.id === id ? { ...n, text, updatedAt: now } : n))
}

export function removeNote(notes: ReviewNote[], id: string): ReviewNote[] {
  return notes.filter((n) => n.id !== id)
}

// Notes for one diff view, in line order.
export function notesFor(notes: ReviewNote[], ref: string, file: string, side?: 'old' | 'new'): ReviewNote[] {
  return notes
    .filter((n) => n.ref === ref && n.file === file && (side === undefined || n.side === side))
    .sort((a, b) => a.line - b.line || a.createdAt.localeCompare(b.createdAt))
}

// Group for the sidebar: ref → file → notes (line order), refs in first-seen order.
export function groupNotes(notes: ReviewNote[]): { ref: string; files: { file: string; notes: ReviewNote[] }[] }[] {
  const byRef = new Map<string, Map<string, ReviewNote[]>>()
  for (const n of notes) {
    let files = byRef.get(n.ref)
    if (!files) { files = new Map(); byRef.set(n.ref, files) }
    let list = files.get(n.file)
    if (!list) { list = []; files.set(n.file, list) }
    list.push(n)
  }
  return [...byRef].map(([ref, files]) => ({
    ref,
    files: [...files].map(([file, list]) => ({ file, notes: [...list].sort((a, b) => a.line - b.line || a.createdAt.localeCompare(b.createdAt)) })),
  }))
}

// Markdown export, e.g. for a PR review or a khef memory:
//   ## commit abc1234
//   - `src/a.ts:12` (old) — text
export function notesToMarkdown(notes: ReviewNote[], labelFor: (ref: string) => string = (r) => r): string {
  const out: string[] = []
  for (const g of groupNotes(notes)) {
    out.push(`## ${labelFor(g.ref)}`, '')
    for (const f of g.files) {
      for (const n of f.notes) {
        const side = n.side === 'old' ? ' (old)' : ''
        const text = n.text.trim().split('\n').join('\n  ')
        out.push(`- \`${f.file}:${n.line}\`${side} — ${text}`)
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + (out.length ? '\n' : '')
}
