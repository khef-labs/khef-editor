import { Compartment } from '@codemirror/state'
import { EditorView, ViewPlugin, lineNumbers, type ViewUpdate } from '@codemirror/view'

// Wrapped documents can leave the gutter DOM at old block positions after a
// viewport change. Remeasuring alone does not redraw those gutter elements.
// Check only after layout/document changes, using CM's batched measurement phase.
export function alignedLineNumbers() {
  const numbers = new Compartment()
  const alignment = ViewPlugin.fromClass(class {
    frame = 0
    destroyed = false

    constructor(readonly view: EditorView) { this.measure() }

    update(update: ViewUpdate) {
      if (update.docChanged || update.geometryChanged || update.viewportChanged) this.measure()
    }

    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const bounds = view.scrollDOM.getBoundingClientRect()
          for (const element of view.dom.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')) {
            // CM's width spacer contains 9/99/999, not a rendered document line.
            // At those exact document lengths its number is otherwise valid.
            if (element.style.visibility === 'hidden') continue
            const line = Number(element.textContent)
            const rect = element.getBoundingClientRect()
            if (!Number.isInteger(line) || line < 1 || line > view.state.doc.lines ||
                rect.top < bounds.top || rect.bottom > bounds.bottom) continue
            const expected = view.documentTop + view.lineBlockAt(view.state.doc.line(line).from).top
            if (Math.abs(expected - rect.top) > 2) return true
          }
          return false
        },
        write: (misaligned) => {
          if (!misaligned || this.frame || this.destroyed) return
          // Dispatch outside the measurement phase. Reconfigure only the number
          // gutter: document, history, selections, and scroll state stay intact.
          this.frame = this.view.dom.ownerDocument.defaultView!.requestAnimationFrame(() => {
            this.frame = 0
            if (!this.destroyed) this.view.dispatch({ effects: numbers.reconfigure(lineNumbers()) })
          })
        },
      })
    }

    destroy() {
      this.destroyed = true
      if (this.frame) this.view.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.frame)
    }
  })
  return [numbers.of(lineNumbers()), alignment]
}

// Explicit recovery for a corrupted rendering. Keep the complete EditorState
// (including history) and restore a document-relative scroll anchor after rebuilding.
export function resetEditorRendering(view: EditorView): void {
  const scroll = view.scrollSnapshot()
  view.setState(view.state)
  view.dispatch({ effects: scroll })
  view.focus()
}
