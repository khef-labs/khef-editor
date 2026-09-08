// Inline review notes inside a read-only diff editor: each note renders as a block widget
// under its line; a composer widget (textarea + Save/Cancel) opens under the line being
// annotated or the note being edited. The note LIST comes from outside via setNotesEffect
// (the store owns it); composer/edit state lives in the editor's own StateField so a
// caller only has to dispatch openComposer / openEditor.

import { StateField, StateEffect, type Extension } from '@codemirror/state'
import { EditorView, Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import type { ReviewNote } from './reviewNotes'

export interface NoteHandlers {
  // A new note (no id) or an edited note (id) on `line` with `text`.
  onSave: (line: number, text: string, id?: string) => void
  onDelete: (id: string) => void
}

export const setNotesEffect = StateEffect.define<ReviewNote[]>()
export const openComposerEffect = StateEffect.define<number>()   // 1-based line
export const openEditorEffect = StateEffect.define<string>()     // note id
export const closeComposerEffect = StateEffect.define<null>()

interface NotesState {
  notes: ReviewNote[]
  composing: number | null
  editingId: string | null
}

function button(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = `cm-review-note-btn ${cls}`
  b.textContent = label
  b.type = 'button'
  return b
}

class NoteWidget extends WidgetType {
  constructor(
    readonly note: ReviewNote | null,   // null = fresh composer
    readonly line: number,
    readonly editing: boolean,
    readonly handlers: NoteHandlers,
  ) { super() }

  override eq(other: NoteWidget) {
    return other.note?.id === this.note?.id && other.note?.text === this.note?.text
      && other.note?.updatedAt === this.note?.updatedAt && other.editing === this.editing && other.line === this.line
  }

  override toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-review-note'
    const close = () => view.dispatch({ effects: closeComposerEffect.of(null) })

    if (this.editing || !this.note) {
      wrap.classList.add('cm-review-note-composing')
      const ta = document.createElement('textarea')
      ta.className = 'cm-review-note-input'
      ta.placeholder = 'Leave a note… (⌘↩ to save, Esc to cancel)'
      ta.rows = 3
      ta.value = this.note?.text ?? ''
      const row = document.createElement('div')
      row.className = 'cm-review-note-actions'
      const save = button('Save', 'cm-review-note-save')
      const cancel = button('Cancel', 'cm-review-note-cancel')
      save.onclick = () => {
        const text = ta.value.trim()
        if (!text) { close(); return }
        this.handlers.onSave(this.line, text, this.note?.id)
        close()
      }
      cancel.onclick = close
      ta.onkeydown = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save.click() }
        else if (e.key === 'Escape') { e.preventDefault(); cancel.click() }
      }
      row.append(save, cancel)
      wrap.append(ta, row)
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }, 0)
      return wrap
    }

    const note = this.note
    const text = document.createElement('div')
    text.className = 'cm-review-note-text'
    text.textContent = note.text
    const meta = document.createElement('div')
    meta.className = 'cm-review-note-meta'
    const when = new Date(note.updatedAt ?? note.createdAt).toLocaleString()
    meta.textContent = `Note · ${when}${note.updatedAt ? ' (edited)' : ''}`
    const row = document.createElement('div')
    row.className = 'cm-review-note-actions'
    const edit = button('Edit', 'cm-review-note-edit')
    const del = button('Delete', 'cm-review-note-delete')
    edit.onclick = () => view.dispatch({ effects: openEditorEffect.of(note.id) })
    del.onclick = () => this.handlers.onDelete(note.id)
    row.append(edit, del)
    wrap.append(text, meta, row)
    return wrap
  }

  // The widget is interactive (textarea, buttons): keep CodeMirror's handlers out of it.
  override ignoreEvent() { return true }
}

export function reviewNotesExtension(handlers: NoteHandlers): Extension {
  const field = StateField.define<NotesState>({
    create: () => ({ notes: [], composing: null, editingId: null }),
    update(state, tr) {
      let next = state
      for (const e of tr.effects) {
        if (e.is(setNotesEffect)) next = { ...next, notes: e.value }
        else if (e.is(openComposerEffect)) next = { ...next, composing: e.value, editingId: null }
        else if (e.is(openEditorEffect)) next = { ...next, editingId: e.value, composing: null }
        else if (e.is(closeComposerEffect)) next = { ...next, composing: null, editingId: null }
      }
      return next
    },
  })

  const decorations = EditorView.decorations.compute([field], (state): DecorationSet => {
    const s = state.field(field)
    const lines = state.doc.lines
    const ranges = []
    for (const n of s.notes) {
      if (n.line < 1 || n.line > lines) continue
      const editing = s.editingId === n.id
      ranges.push(Decoration.widget({ widget: new NoteWidget(n, n.line, editing, handlers), block: true, side: 1 }).range(state.doc.line(n.line).to))
    }
    if (s.composing != null && s.composing >= 1 && s.composing <= lines) {
      ranges.push(Decoration.widget({ widget: new NoteWidget(null, s.composing, true, handlers), block: true, side: 2 }).range(state.doc.line(s.composing).to))
    }
    return Decoration.set(ranges, true)
  })

  return [field, decorations]
}
