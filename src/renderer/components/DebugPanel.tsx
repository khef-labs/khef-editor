import { useEffect, useState, useCallback } from 'preact/hooks'
import { ChevronRight, ChevronDown, Play } from 'lucide-preact'
import type { DebugStackFrame, DebugScope, DebugVariable } from '../../../electron/types'

export type DebugStatus = 'idle' | 'starting' | 'running' | 'stopped'

interface DebugPanelProps {
  status: DebugStatus
  // Bumped by App on every stopped event, so the panel refetches the stack even when two
  // consecutive stops land on the same line (state identity wouldn't change otherwise).
  stoppedToken: number
  onOpenFrame: (path: string, line: number) => void
  onStart: () => void
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

// Variables under one variablesReference, as a lazily-expanded tree. Each expandable
// child fetches its own children on first expand (DAP's variablesReference chaining).
function VariableList({ variablesReference, depth }: { variablesReference: number; depth: number }) {
  const [vars, setVars] = useState<DebugVariable[] | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    window.editorApi.debug.variables(variablesReference).then(
      (r) => { if (alive) setVars(r.variables) },
      () => { if (alive) setVars([]) },
    )
    return () => { alive = false }
  }, [variablesReference])

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
            {isOpen && <VariableList variablesReference={v.variablesReference} depth={depth + 1} />}
          </div>
        )
      })}
    </>
  )
}

export function DebugPanel({ status, stoppedToken, onOpenFrame, onStart }: DebugPanelProps) {
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

  if (status === 'idle') {
    return (
      <div class="dbg-panel" data-testid="debug-panel">
        <div class="sidebar-header">Run and Debug</div>
        <div class="dbg-idle">
          <button class="dbg-start-btn" onClick={onStart}><Play size={14} /> Start Debugging</button>
          <p class="hint">F5 runs the focused file under the debugger (Python and Ruby supported). Click in the gutter to set breakpoints.</p>
        </div>
      </div>
    )
  }

  return (
    <div class="dbg-panel" data-testid="debug-panel">
      <div class="dbg-titlebar">
        <span class="sidebar-header">Run and Debug</span>
        <span class={`dbg-status dbg-status-${status}`}>{statusLabel[status]}</span>
      </div>

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
              {!scope.expensive && <VariableList variablesReference={scope.variablesReference} depth={0} />}
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
