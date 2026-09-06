import { useEffect, useState, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, Play } from 'lucide-preact'
import type { DebugStackFrame, DebugScope, DebugVariable } from '../../../electron/types'
import { childRequests, assembleChildren, type VarNode } from '../lib/debugVariables'
import type { TestRunSummary, TestResult } from '../lib/pytestResults'

export type DebugStatus = 'idle' | 'starting' | 'running' | 'stopped'

interface DebugPanelProps {
  status: DebugStatus
  // Bumped by App on every stopped event, so the panel refetches the stack even when two
  // consecutive stops land on the same line (state identity wouldn't change otherwise).
  stoppedToken: number
  onOpenFrame: (path: string, line: number) => void
  onStart: () => void
  // Parsed pytest results for the current run, or null when the run isn't a test run.
  // When present, a Test Results section renders above Variables/Call Stack.
  testRun: TestRunSummary | null
  onOpenTestLocation: (file: string, line?: number) => void
}

const statusLabel: Record<DebugStatus, string> = {
  idle: '',
  starting: 'Starting…',
  running: 'Running',
  stopped: 'Paused',
}

function frameLocation(f: DebugStackFrame): string {
  const name = f.source?.name ?? f.source?.path?.split('/').pop() ?? ''
  return name ? `${name}:${f.line}` : `line ${f.line}`
}

// Fetch a node's children by running its planned requests (see lib/debugVariables) and
// assembling the results — named members then indexed elements for a collection, or a
// single plain request for a leaf.
async function fetchChildren(node: VarNode): Promise<DebugVariable[]> {
  const results = await Promise.all(
    childRequests(node).map((r) =>
      window.editorApi.debug.variables(r.ref, r.filter ? { filter: r.filter, start: r.start, count: r.count } : undefined)
        .then((res) => res.variables),
    ),
  )
  return assembleChildren(node, results) as DebugVariable[]
}

// Variables under one variable node, as a lazily-expanded tree. Each expandable child
// fetches its own children on first expand (DAP's variablesReference chaining).
function VariableList({ parent, depth }: { parent: VarNode; depth: number }) {
  const [vars, setVars] = useState<DebugVariable[] | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    fetchChildren(parent).then(
      (list) => { if (alive) setVars(list) },
      () => { if (alive) setVars([]) },
    )
    return () => { alive = false }
  }, [parent.variablesReference, parent.indexedVariables, parent.namedVariables])

  if (vars === null) return <div class="dbg-loading" style={{ paddingLeft: `${depth * 14 + 24}px` }}>…</div>
  return (
    <>
      {vars.map((v, i) => {
        const expandable = v.variablesReference > 0
        const isOpen = expanded.has(i)
        return (
          <div key={`${v.name}-${i}`}>
            <div
              class="dbg-var-row"
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              onClick={() => {
                if (!expandable) return
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(i)) next.delete(i); else next.add(i)
                  return next
                })
              }}
            >
              <span class="dbg-twist">{expandable ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</span>
              <span class="dbg-var-name">{v.name}</span>
              <span class="dbg-var-value" title={v.value}>{v.value}</span>
            </div>
            {isOpen && <VariableList parent={v} depth={depth + 1} />}
          </div>
        )
      })}
    </>
  )
}

const outcomeGlyph: Record<TestResult['outcome'], string> = { passed: '✓', failed: '✕', error: '✕', skipped: '○' }

// Test Results: per-test pass/fail rows (failures first) with a counts header. Clicking a
// row opens the failure location (or the test file for a pass). Driven entirely by the
// parsed console output, so it fills in live as tests report.
function TestResults({ run, onOpen }: { run: TestRunSummary; onOpen: (file: string, line?: number) => void }) {
  const [open, setOpen] = useState(true)
  if (run.results.length === 0) return null
  // Failures first (what you want to see), then the rest in run order.
  const ordered = [...run.results].sort((a, b) => {
    const bad = (r: TestResult) => (r.outcome === 'failed' || r.outcome === 'error' ? 0 : 1)
    return bad(a) - bad(b)
  })
  return (
    <>
      <button class="scm-section-header" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Test Results</span>
        <span class="dbg-test-counts">
          <span class="dbg-test-pass">{run.passed}✓</span>
          {(run.failed + run.errored) > 0 && <span class="dbg-test-fail">{run.failed + run.errored}✕</span>}
          {run.skipped > 0 && <span class="dbg-test-skip">{run.skipped}○</span>}
        </span>
      </button>
      {open && (
        <div class="dbg-tests">
          {ordered.map((t) => {
            const bad = t.outcome === 'failed' || t.outcome === 'error'
            return (
              <div
                key={t.nodeid}
                class={`dbg-test-row dbg-test-${t.outcome}`}
                title={t.reason ? `${t.nodeid}\n${t.reason}` : t.nodeid}
                onClick={() => onOpen(bad && t.failFile ? t.failFile : t.file, bad ? t.failLine : undefined)}
              >
                <span class="dbg-test-glyph">{outcomeGlyph[t.outcome]}</span>
                <span class="dbg-test-name">{t.name}</span>
                {bad && t.reason && <span class="dbg-test-reason">{t.reason}</span>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function DebugPanel({ status, stoppedToken, onOpenFrame, onStart, testRun, onOpenTestLocation }: DebugPanelProps) {
  const [frames, setFrames] = useState<DebugStackFrame[]>([])
  const [selectedFrame, setSelectedFrame] = useState(0)
  const [scopes, setScopes] = useState<DebugScope[]>([])
  const [scopesOpen, setScopesOpen] = useState(true)
  const [stackOpen, setStackOpen] = useState(true)

  // On each stop, refetch the stack and select the top frame. Anything else clears it.
  useEffect(() => {
    if (status !== 'stopped') { setFrames([]); setScopes([]); setSelectedFrame(0); return }
    let alive = true
    window.editorApi.debug.stackTrace().then(
      (r) => { if (alive) { setFrames(r.stackFrames); setSelectedFrame(0) } },
      () => { if (alive) setFrames([]) },
    )
    return () => { alive = false }
  }, [status, stoppedToken])

  // Scopes follow the selected frame.
  useEffect(() => {
    const frame = frames[selectedFrame]
    if (!frame) { setScopes([]); return }
    let alive = true
    window.editorApi.debug.scopes(frame.id).then(
      (r) => { if (alive) setScopes(r.scopes) },
      () => { if (alive) setScopes([]) },
    )
    return () => { alive = false }
  }, [frames, selectedFrame])

  const pickFrame = useCallback((i: number) => {
    setSelectedFrame(i)
    const f = frames[i]
    if (f?.source?.path) onOpenFrame(f.source.path, f.line)
  }, [frames, onOpenFrame])

  // A finished test run lands the session in 'idle' but its results should persist.
  const hasResults = !!testRun && testRun.results.length > 0

  if (status === 'idle') {
    return (
      <div class="dbg-panel" data-testid="debug-panel">
        <div class="sidebar-header">Run and Debug</div>
        {hasResults && testRun && <TestResults run={testRun} onOpen={onOpenTestLocation} />}
        {!hasResults && (
          <div class="dbg-idle">
            <button class="dbg-start-btn" onClick={onStart}><Play size={14} /> Start Debugging</button>
            <p class="hint">F5 runs the focused file under the debugger (Python and Ruby supported). Click in the gutter to set breakpoints.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div class="dbg-panel" data-testid="debug-panel">
      <div class="dbg-titlebar">
        <span class="sidebar-header">Run and Debug</span>
        <span class={`dbg-status dbg-status-${status}`}>{statusLabel[status]}</span>
      </div>

      {hasResults && testRun && <TestResults run={testRun} onOpen={onOpenTestLocation} />}

      {/* VARIABLES */}
      <button class="scm-section-header" onClick={() => setScopesOpen((v) => !v)}>
        {scopesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Variables</span>
      </button>
      {scopesOpen && (
        <div class="dbg-vars">
          {status !== 'stopped' && <div class="scm-empty-row">Running — pause at a breakpoint to inspect</div>}
          {status === 'stopped' && scopes.map((scope) => (
            <div key={scope.variablesReference}>
              <div class="dbg-scope-label">{scope.name}</div>
              {!scope.expensive && <VariableList parent={{ variablesReference: scope.variablesReference }} depth={0} />}
            </div>
          ))}
        </div>
      )}

      {/* CALL STACK */}
      <button class="scm-section-header" onClick={() => setStackOpen((v) => !v)}>
        {stackOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Call Stack</span>
      </button>
      {stackOpen && (
        <div class="dbg-stack">
          {status !== 'stopped' && <div class="scm-empty-row">Running…</div>}
          {status === 'stopped' && frames.map((f, i) => (
            <div
              key={f.id}
              class={`dbg-frame-row${i === selectedFrame ? ' selected' : ''}`}
              onClick={() => pickFrame(i)}
              title={f.source?.path ?? ''}
            >
              <span class="dbg-frame-name">{f.name}</span>
              <span class="dbg-frame-loc">{frameLocation(f)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
