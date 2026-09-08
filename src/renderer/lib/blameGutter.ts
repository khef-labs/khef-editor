// Git blame as a gutter: one label per run of consecutive lines from the same commit
// (short hash · author · age), with the full summary and date in the tooltip. Driven from
// App (which fetches blame per file) via a StateEffect, like the breakpoint gutter.

import { StateField, StateEffect, RangeSet } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { gutter, GutterMarker } from '@codemirror/view'
import type { GitBlameRun } from '../../../electron/types'
import { relativeTime } from './relativeTime'

export const setBlameEffect = StateEffect.define<GitBlameRun[]>()

const UNCOMMITTED = '0000000000000000000000000000000000000000'

class BlameMarker extends GutterMarker {
  constructor(readonly run: GitBlameRun, readonly first: boolean) { super() }
  override eq(other: BlameMarker) { return other.run === this.run && other.first === this.first }
  override toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-blame-line' + (this.first ? ' cm-blame-first' : '') + (this.run.hash === UNCOMMITTED ? ' cm-blame-uncommitted' : '')
    if (this.first) {
      const uncommitted = this.run.hash === UNCOMMITTED
      const when = this.run.time ? relativeTime(new Date(this.run.time * 1000).toISOString()) : ''
      el.textContent = uncommitted ? 'Uncommitted' : `${this.run.short} ${this.run.author} ${when}`
      el.title = uncommitted
        ? 'Not yet committed'
        : `${this.run.short} — ${this.run.summary}\n${this.run.author}, ${this.run.time ? new Date(this.run.time * 1000).toLocaleString() : ''}`
    }
    return el
  }
}

const blameField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setBlameEffect)) continue
      const markers: { from: number; marker: GutterMarker }[] = []
      const lines = tr.state.doc.lines
      for (const run of e.value) {
        for (let n = run.line; n < run.line + run.count && n <= lines; n++) {
          if (n < 1) continue
          markers.push({ from: tr.state.doc.line(n).from, marker: new BlameMarker(run, n === run.line) })
        }
      }
      markers.sort((a, b) => a.from - b.from)
      set = RangeSet.of(markers.map((m) => m.marker.range(m.from)))
    }
    return set
  },
})

// Spacer sets the column width: a typical "abc1234 Firstname Lastname 3mo ago" label.
class BlameSpacer extends GutterMarker {
  override toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-blame-line cm-blame-first'
    el.textContent = 'abcdef0 Firstname Lastname 12mo ago'
    return el
  }
}

export function blameGutter(): Extension {
  return [
    blameField,
    gutter({
      class: 'cm-blame-gutter',
      markers: (view) => view.state.field(blameField),
      initialSpacer: () => new BlameSpacer(),
    }),
  ]
}
