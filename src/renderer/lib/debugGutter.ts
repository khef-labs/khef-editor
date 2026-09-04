// CodeMirror extensions for debugging: a clickable breakpoint gutter and the
// stopped-execution line highlight. Both are driven from OUTSIDE the editor (App owns
// breakpoint state and debug session state) via StateEffects, so the editor stays a
// projection of app state rather than owning any of it.

import { StateField, StateEffect, RangeSet } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, gutter, GutterMarker, Decoration } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'

// Replace the full breakpoint set for this editor (1-based line numbers).
export const setBreakpointsEffect = StateEffect.define<number[]>()
// Move/clear the stopped-line highlight (1-based line, or null when running/idle).
export const setStoppedLineEffect = StateEffect.define<number | null>()

class BreakpointDot extends GutterMarker {
  override toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-breakpoint-dot'
    return el
  }
}
const dot = new BreakpointDot()

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setBreakpointsEffect)) continue
      const lines = [...new Set(e.value)]
        .filter((n) => n >= 1 && n <= tr.state.doc.lines)
        .sort((a, b) => a - b)
      set = RangeSet.of(lines.map((n) => dot.range(tr.state.doc.line(n).from)))
    }
    return set
  },
})

// The gutter itself. `onToggle` receives the 1-based line clicked; App flips the
// breakpoint and pushes the new set back down via setBreakpointsEffect.
export function breakpointGutter(onToggle: (line: number) => void): Extension {
  return [
    breakpointField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers: (view) => view.state.field(breakpointField),
      initialSpacer: () => dot,
      domEventHandlers: {
        mousedown(view, block) {
          onToggle(view.state.doc.lineAt(block.from).number)
          return true
        },
      },
    }),
  ]
}

const stoppedLineDeco = Decoration.line({ class: 'cm-debug-stopped-line' })

export const stoppedLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setStoppedLineEffect)) continue
      deco = e.value == null || e.value < 1 || e.value > tr.state.doc.lines
        ? Decoration.none
        : Decoration.set([stoppedLineDeco.range(tr.state.doc.line(e.value).from)])
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
