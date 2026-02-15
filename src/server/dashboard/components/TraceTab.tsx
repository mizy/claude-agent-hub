import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, type TraceData, type TraceSpan } from '../store/useStore'

// ============ Helpers ============

function fmtDur(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function fmtCost(usd: number) {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function fmtTokens(n: number) {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

function spanColor(span: TraceSpan): string {
  if (span.status === 'error') return '#ef4444'
  if (span.durationMs && span.durationMs > 30000) return '#f59e0b'
  if (span.status === 'running') return '#3b82f6'
  return '#22c55e'
}

function spanBgColor(span: TraceSpan): string {
  if (span.status === 'error') return 'rgba(239, 68, 68, 0.15)'
  if (span.durationMs && span.durationMs > 30000) return 'rgba(245, 158, 11, 0.15)'
  if (span.status === 'running') return 'rgba(59, 130, 246, 0.15)'
  return 'rgba(34, 197, 94, 0.15)'
}

interface SpanRow {
  span: TraceSpan
  depth: number
  children: SpanRow[]
}

/** Build a tree of spans for a trace */
function buildSpanTree(spans: TraceSpan[]): SpanRow[] {
  const byId = new Map<string, TraceSpan>()
  const childMap = new Map<string, TraceSpan[]>()

  for (const s of spans) {
    byId.set(s.spanId, s)
    const pid = s.parentSpanId || '__root__'
    if (!childMap.has(pid)) childMap.set(pid, [])
    childMap.get(pid)!.push(s)
  }

  function buildRow(span: TraceSpan, depth: number): SpanRow {
    const kids = (childMap.get(span.spanId) || []).sort((a, b) => a.startTime - b.startTime)
    return { span, depth, children: kids.map(k => buildRow(k, depth + 1)) }
  }

  const roots = childMap.get('__root__') || []
  return roots.sort((a, b) => a.startTime - b.startTime).map(r => buildRow(r, 0))
}

/** Flatten the tree to a list of rows for rendering */
function flattenTree(rows: SpanRow[], collapsed: Set<string>): SpanRow[] {
  const result: SpanRow[] = []
  function walk(r: SpanRow) {
    result.push(r)
    if (!collapsed.has(r.span.spanId)) {
      r.children.forEach(walk)
    }
  }
  rows.forEach(walk)
  return result
}

// ============ Flame Chart ============

const ROW_HEIGHT = 28
const MIN_BAR_WIDTH = 4

function FlameChart({ trace }: { trace: TraceData }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hoveredSpan, setHoveredSpan] = useState<TraceSpan | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const tree = buildSpanTree(trace.spans)
  const flat = flattenTree(tree, collapsed)

  // Time range
  const minTime = Math.min(...trace.spans.map(s => s.startTime))
  const maxTime = Math.max(...trace.spans.map(s => (s.endTime ?? s.startTime) + 1))
  const totalDuration = maxTime - minTime || 1

  const toggleCollapse = useCallback((spanId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(spanId)) next.delete(spanId)
      else next.add(spanId)
      return next
    })
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent, span: TraceSpan) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHoveredSpan(span)
    setTooltipPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8 })
  }, [])

  const handleMouseLeave = useCallback(() => setHoveredSpan(null), [])

  return (
    <div className="flame-chart-container" ref={containerRef}>
      {/* Time ruler */}
      <div className="flame-ruler">
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <span key={pct} className="flame-ruler-mark" style={{ left: `${pct * 100}%` }}>
            {fmtDur(pct * totalDuration)}
          </span>
        ))}
      </div>

      {/* Span rows */}
      <div className="flame-rows">
        {flat.map((row, idx) => {
          const s = row.span
          const left = ((s.startTime - minTime) / totalDuration) * 100
          const width = Math.max(((s.durationMs ?? 1) / totalDuration) * 100, 0.3)
          const hasChildren = row.children.length > 0
          const isCollapsed = collapsed.has(s.spanId)

          return (
            <div key={s.spanId} className="flame-row" style={{ height: ROW_HEIGHT }}>
              {/* Label area */}
              <div className="flame-label" style={{ paddingLeft: row.depth * 16 + 4 }}>
                {hasChildren && (
                  <button
                    className="flame-toggle"
                    onClick={() => toggleCollapse(s.spanId)}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                )}
                <span className="flame-kind" data-kind={s.kind}>{s.kind}</span>
                <span className="flame-name">{s.name}</span>
              </div>

              {/* Bar area */}
              <div className="flame-bar-area">
                <div
                  className="flame-bar"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    minWidth: MIN_BAR_WIDTH,
                    background: spanBgColor(s),
                    borderLeft: `3px solid ${spanColor(s)}`,
                  }}
                  onMouseMove={e => handleMouseMove(e, s)}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => hasChildren && toggleCollapse(s.spanId)}
                >
                  <span className="flame-bar-text">
                    {s.durationMs != null ? fmtDur(s.durationMs) : '...'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Tooltip */}
      {hoveredSpan && (
        <div
          className="flame-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="flame-tooltip-title">{hoveredSpan.name}</div>
          <div className="flame-tooltip-row">
            <span className="flame-tooltip-label">Kind:</span> {hoveredSpan.kind}
          </div>
          <div className="flame-tooltip-row">
            <span className="flame-tooltip-label">Status:</span>
            <span style={{ color: spanColor(hoveredSpan) }}> {hoveredSpan.status}</span>
          </div>
          <div className="flame-tooltip-row">
            <span className="flame-tooltip-label">Duration:</span>{' '}
            {hoveredSpan.durationMs != null ? fmtDur(hoveredSpan.durationMs) : 'running'}
          </div>
          {hoveredSpan.tokenUsage && (
            <div className="flame-tooltip-row">
              <span className="flame-tooltip-label">Tokens:</span>{' '}
              {fmtTokens(hoveredSpan.tokenUsage.totalTokens)}
              {' ('}in: {fmtTokens(hoveredSpan.tokenUsage.inputTokens)}, out:{' '}
              {fmtTokens(hoveredSpan.tokenUsage.outputTokens)}{')'}
            </div>
          )}
          {hoveredSpan.cost && (
            <div className="flame-tooltip-row">
              <span className="flame-tooltip-label">Cost:</span> {fmtCost(hoveredSpan.cost.amount)}
            </div>
          )}
          {hoveredSpan.error && (
            <div className="flame-tooltip-row" style={{ color: '#fca5a5' }}>
              <span className="flame-tooltip-label">Error:</span> {hoveredSpan.error.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ Cost Summary ============

interface NodeCostRow {
  name: string
  kind: string
  tokens: number
  cost: number
  durationMs: number
  calls: number
}

function CostSummary({ trace }: { trace: TraceData }) {
  // Group by node
  const nodeMap = new Map<string, NodeCostRow>()

  for (const span of trace.spans) {
    if (span.kind !== 'node' && span.kind !== 'llm') continue
    const nodeId = (span.attributes['node.id'] as string) || span.name
    const nodeName = (span.attributes['node.name'] as string) || span.name

    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, { name: nodeName, kind: span.kind, tokens: 0, cost: 0, durationMs: 0, calls: 0 })
    }
    const row = nodeMap.get(nodeId)!

    if (span.kind === 'llm') {
      row.tokens += span.tokenUsage?.totalTokens ?? 0
      row.cost += span.cost?.amount ?? 0
      row.calls++
      row.durationMs += span.durationMs ?? 0
    } else if (span.kind === 'node') {
      row.durationMs = span.durationMs ?? 0
    }
  }

  const rows = [...nodeMap.values()].filter(r => r.tokens > 0 || r.cost > 0)
  rows.sort((a, b) => b.cost - a.cost)

  const totalCost = rows.reduce((sum, r) => sum + r.cost, 0)

  return (
    <div className="trace-cost-summary">
      <div className="panel-section">
        <div className="panel-section-title">Overview</div>
        <div className="info-grid">
          <div className="info-item">
            <div className="label">Duration</div>
            <div className="value">{fmtDur(trace.totalDurationMs)}</div>
          </div>
          <div className="info-item">
            <div className="label">Total Tokens</div>
            <div className="value">{fmtTokens(trace.totalTokens)}</div>
          </div>
          <div className="info-item">
            <div className="label">Total Cost</div>
            <div className="value">{fmtCost(trace.totalCost)}</div>
          </div>
          <div className="info-item">
            <div className="label">LLM Calls</div>
            <div className="value">{trace.llmCallCount}</div>
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">Cost by Node</div>
          <div className="trace-cost-table">
            <div className="trace-cost-header">
              <span>Node</span>
              <span>Calls</span>
              <span>Tokens</span>
              <span>Cost</span>
              <span>%</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="trace-cost-row">
                <span className="trace-cost-name">{r.name}</span>
                <span>{r.calls}</span>
                <span>{fmtTokens(r.tokens)}</span>
                <span>{fmtCost(r.cost)}</span>
                <span>{totalCost > 0 ? `${((r.cost / totalCost) * 100).toFixed(0)}%` : '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top slow spans */}
      <SlowSpans trace={trace} />
    </div>
  )
}

// ============ Slow Spans ============

function SlowSpans({ trace }: { trace: TraceData }) {
  const sorted = [...trace.spans]
    .filter(s => s.durationMs != null && s.durationMs > 0)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 10)

  if (sorted.length === 0) return null

  return (
    <div className="panel-section">
      <div className="panel-section-title">Top 10 Slowest Spans</div>
      <div className="trace-slow-list">
        {sorted.map(s => (
          <div key={s.spanId} className="trace-slow-item">
            <div className="trace-slow-info">
              <span className="flame-kind" data-kind={s.kind}>{s.kind}</span>
              <span className="trace-slow-name">{s.name}</span>
            </div>
            <div className="trace-slow-dur" style={{ color: spanColor(s) }}>
              {fmtDur(s.durationMs!)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Main TraceTab ============

export function TraceTab() {
  const taskData = useStore(s => s.taskData)
  const traceData = useStore(s => s.traceData)
  const refreshTraceData = useStore(s => s.refreshTraceData)
  const [selectedTraceIdx, setSelectedTraceIdx] = useState(0)
  const [view, setView] = useState<'flame' | 'cost'>('flame')

  useEffect(() => {
    if (taskData?.task?.id) refreshTraceData()
  }, [taskData?.task?.id, refreshTraceData])

  if (!traceData || traceData.length === 0) {
    return <div className="empty-state">No trace data available</div>
  }

  const trace = traceData[selectedTraceIdx] || traceData[0]

  return (
    <div className="trace-tab">
      {/* Trace selector + view toggle */}
      <div className="trace-toolbar">
        {traceData.length > 1 && (
          <select
            className="trace-select"
            value={selectedTraceIdx}
            onChange={e => setSelectedTraceIdx(Number(e.target.value))}
          >
            {traceData.map((t, i) => (
              <option key={t.traceId} value={i}>
                Trace {i + 1} — {fmtDur(t.totalDurationMs)} / {fmtTokens(t.totalTokens)} tokens
              </option>
            ))}
          </select>
        )}
        <div className="trace-view-toggle">
          <button
            className={`trace-view-btn ${view === 'flame' ? 'active' : ''}`}
            onClick={() => setView('flame')}
          >
            Flame
          </button>
          <button
            className={`trace-view-btn ${view === 'cost' ? 'active' : ''}`}
            onClick={() => setView('cost')}
          >
            Cost
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="trace-legend">
        <span className="trace-legend-item"><span className="trace-legend-dot" style={{ background: '#22c55e' }} /> OK</span>
        <span className="trace-legend-item"><span className="trace-legend-dot" style={{ background: '#f59e0b' }} /> Slow (&gt;30s)</span>
        <span className="trace-legend-item"><span className="trace-legend-dot" style={{ background: '#ef4444' }} /> Error</span>
        <span className="trace-legend-item"><span className="trace-legend-dot" style={{ background: '#3b82f6' }} /> Running</span>
      </div>

      {view === 'flame' ? <FlameChart trace={trace} /> : <CostSummary trace={trace} />}
    </div>
  )
}
