import { useEffect, useMemo, useState, useCallback } from 'preact/hooks'
import type { RefObject } from 'preact'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import type { DiffHandle, DiffNotesOptions, DiffSide } from '../lib/diffMount'
import { addNote, updateNote, removeNote, notesFor, newNoteId } from '../lib/reviewNotes'
import { reviewNotesStore, useReviewNotes } from '../lib/reviewNotesStore'

// Review-note plumbing shared by the diff tab and review-page cards: the options handed to
// mountDiff (save/delete handlers + line context menu), a `pushNotes` to feed a freshly
// mounted editor, and the context menu element to render.
export function useDiffNotes(ref: string, file: string, handleRef: RefObject<DiffHandle | null>) {
  const all = useReviewNotes()
  const [menu, setMenu] = useState<{ side: DiffSide; line: number; x: number; y: number } | null>(null)

  const notesOptions = useMemo<DiffNotesOptions>(() => ({
    handlers: (side) => ({
      onSave: (line, text, id) => {
        const cur = reviewNotesStore.get()
        reviewNotesStore.set(id
          ? updateNote(cur, id, text)
          : addNote(cur, { id: newNoteId(), ref, file, side, line, text, createdAt: new Date().toISOString() }))
      },
      onDelete: (id) => reviewNotesStore.set(removeNote(reviewNotesStore.get(), id)),
    }),
    onLineContextMenu: (side, line, x, y) => setMenu({ side, line, x, y }),
  }), [ref, file])

  const pushNotes = useCallback((h: DiffHandle) => {
    const cur = reviewNotesStore.get()
    h.setNotes('old', notesFor(cur, ref, file, 'old'))
    h.setNotes('new', notesFor(cur, ref, file, 'new'))
  }, [ref, file])

  // Re-push whenever the store changes (another view added/edited a note).
  useEffect(() => {
    const h = handleRef.current
    if (h) pushNotes(h)
  }, [all, pushNotes, handleRef])

  const count = useMemo(() => notesFor(all, ref, file).length, [all, ref, file])

  const menuEl = menu ? (() => {
    const entries: MenuEntry[] = [
      { kind: 'item', label: `Add Note on Line ${menu.line}`, onClick: () => handleRef.current?.openComposer(menu.side, menu.line) },
    ]
    return <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} />
  })() : null

  return { notesOptions, pushNotes, menuEl, count }
}
