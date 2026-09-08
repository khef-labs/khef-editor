// Live store for the open repository's review notes. Components subscribe (useReviewNotes)
// instead of threading notes through PaneTree → EditorGroupView → every diff. App loads the
// notes for the workspace root from settings on open and persists every change.

import { useEffect, useState } from 'preact/hooks'
import type { ReviewNote } from './reviewNotes'

type Listener = (notes: ReviewNote[]) => void

let root: string | null = null
let notes: ReviewNote[] = []
const listeners = new Set<Listener>()

function emit() { for (const l of listeners) l(notes) }

export const reviewNotesStore = {
  get(): ReviewNote[] { return notes },
  root(): string | null { return root },
  // Replace the whole set (workspace open / settings load). No persistence.
  load(nextRoot: string | null, next: ReviewNote[]) {
    root = nextRoot
    notes = next
    emit()
  },
  // Apply a change and persist the repo's notes into settings.
  set(next: ReviewNote[]) {
    notes = next
    emit()
    if (!root) return
    const r = root
    window.editorApi.getSettings()
      .then((s) => window.editorApi.setSettings({ reviewNotes: { ...(s.reviewNotes ?? {}), [r]: next } }))
      .catch(() => {})
  },
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}

export function useReviewNotes(): ReviewNote[] {
  const [state, setState] = useState<ReviewNote[]>(notes)
  useEffect(() => reviewNotesStore.subscribe(setState), [])
  return state
}
