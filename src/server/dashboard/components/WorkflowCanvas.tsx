import { useRef, useEffect, useCallback } from 'react'
import { useStore, WorkflowNode, WorkflowEdge } from '../store/useStore'

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280', ready: '#6b7280', running: '#3b82f6', waiting: '#3b82f6',
  done: '#22c55e', failed: '#ef4444', skipped: '#eab308',
}
const NODE_W = 180, NODE_H = 56, X_GAP = 100, Y_GAP = 30
const START_X = 50, START_Y = 50, MIN_SCALE = 0.1, MAX_SCALE = 5, DRAG_THRESHOLD = 5

interface NodePos { x: number; y: number; width: number; height: number; isLoopBody?: boolean; loopId?: string }

// Detect back-edges via DFS to avoid breaking topological layout with cycles
function findBackEdges(nodeIds: string[], adjFull: Record<string, string[]>): Set<string> {
  const backEdges = new Set<string>()
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color: Record<string, number> = {}
  nodeIds.forEach(id => { color[id] = WHITE })
  function dfs(u: string) {
    color[u] = GRAY
    for (const v of (adjFull[u] || [])) {
      if (color[v] === GRAY) backEdges.add(`${u}->${v}`)
      else if (color[v] === WHITE) dfs(v)
    }
    color[u] = BLACK
  }
  nodeIds.forEach(id => { if (color[id] === WHITE) dfs(id) })
  return backEdges
}

function layoutNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): { pos: Record<string, NodePos>; backEdges: Set<string> } {
  const pos: Record<string, NodePos> = {}
  const loopMap = new Map<string, string[]>()
  nodes.forEach(n => { if (n.type === 'loop' && n.config?.bodyNodes) loopMap.set(n.id, n.config.bodyNodes) })
  const bodySet = new Set<string>()
  loopMap.forEach(b => b.forEach(id => bodySet.add(id)))
  const main = nodes.filter(n => !bodySet.has(n.id))

  // Build full adjacency to detect back-edges
  const adjFull: Record<string, string[]> = {}
  main.forEach(n => { adjFull[n.id] = [] })
  edges.forEach(e => {
    if (!bodySet.has(e.from) && !bodySet.has(e.to) && adjFull[e.from])
      adjFull[e.from].push(e.to)
  })
  const backEdges = findBackEdges(main.map(n => n.id), adjFull)

  // Topological layout using only forward edges (exclude back-edges)
  const deg: Record<string, number> = {}, adj: Record<string, string[]> = {}
  main.forEach(n => { deg[n.id] = 0; adj[n.id] = [] })
  edges.forEach(e => {
    if (!bodySet.has(e.from) && !bodySet.has(e.to) && !backEdges.has(`${e.from}->${e.to}`)) {
      if (adj[e.from]) adj[e.from].push(e.to)
      if (deg[e.to] !== undefined) deg[e.to]++
    }
  })
  const levels: string[][] = []
  let q = main.filter(n => deg[n.id] === 0).map(n => n.id)
  const vis = new Set<string>()
  while (q.length) {
    const lv: string[] = [], nq: string[] = []
    for (const id of q) {
      if (vis.has(id)) continue; vis.add(id); lv.push(id)
      for (const n of (adj[id] || [])) { deg[n]--; if (deg[n] === 0) nq.push(n) }
    }
    if (lv.length) levels.push(lv); q = nq
  }
  main.forEach(n => { if (!vis.has(n.id)) { if (!levels.length) levels.push([]); levels[levels.length - 1].push(n.id) } })
  let maxY = START_Y
  levels.forEach((lv, li) => {
    const x = START_X + li * (NODE_W + X_GAP)
    lv.forEach((id, ni) => { const y = START_Y + ni * (NODE_H + Y_GAP); pos[id] = { x, y, width: NODE_W, height: NODE_H }; maxY = Math.max(maxY, y + NODE_H) })
  })
  loopMap.forEach((body, lid) => {
    const lp = pos[lid]; if (!lp) return; const by = maxY + Y_GAP * 2
    body.forEach((id, i) => { pos[id] = { x: lp.x + i * (NODE_W + X_GAP / 2), y: by, width: NODE_W, height: NODE_H, isLoopBody: true, loopId: lid } })
  })
  return { pos, backEdges }
}

function fmtDur(ms: number) { return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m` }

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, a: number) {
  const s = 8; ctx.beginPath(); ctx.moveTo(x, y)
  ctx.lineTo(x - s * Math.cos(a - Math.PI / 6), y - s * Math.sin(a - Math.PI / 6))
  ctx.lineTo(x - s * Math.cos(a + Math.PI / 6), y - s * Math.sin(a + Math.PI / 6))
  ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill()
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  arrowHead(ctx, x2, y2, Math.atan2(y2 - y1, x2 - x1))
}

export function WorkflowCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const taskData = useStore((s) => s.taskData)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const selectNode = useStore((s) => s.selectNode)

  const pan = useRef({ x: 0, y: 0 })
  const scale = useRef(1)
  const nodePos = useRef<Record<string, NodePos>>({})
  const backEdgesRef = useRef<Set<string>>(new Set())
  const drag = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const anim = useRef<number | null>(null)
  const touch = useRef({ dist: 0, mx: 0, my: 0, on: false, lx: 0, ly: 0, sx: 0, sy: 0, moved: false })
  const prevWorkflowKey = useRef<string | null>(null)

  const draw = useCallback(() => {
    const cv = canvasRef.current, co = contRef.current
    if (!cv || !co) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const r = co.getBoundingClientRect(), dpr = devicePixelRatio || 1
    cv.width = r.width * dpr; cv.height = r.height * dpr
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height)
    if (!taskData?.workflow) return
    ctx.save(); ctx.translate(pan.current.x, pan.current.y); ctx.scale(scale.current, scale.current)
    const nodes = taskData.workflow.nodes, edges = taskData.workflow.edges || []
    const ns = taskData.instance?.nodeStates || {}, p = nodePos.current, sel = useStore.getState().selectedNodeId
    const lm = new Map<string, string[]>()
    nodes.forEach(n => { if (n.type === 'loop' && n.config?.bodyNodes) lm.set(n.id, n.config.bodyNodes) })

    const backEdges = backEdgesRef.current
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 2
    edges.forEach(e => {
      const f = p[e.from], t = p[e.to]; if (!f || !t) return
      if (backEdges.has(`${e.from}->${e.to}`)) {
        // Draw back-edge as a curved arc below nodes (amber dashed)
        ctx.strokeStyle = '#f59e0b'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5
        const sx = f.x + f.width / 2, sy = f.y + f.height
        const ex = t.x + t.width / 2, ey = t.y + t.height
        const cy = Math.max(sy, ey) + 55
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + ex) / 2, cy, ex, ey); ctx.stroke()
        arrowHead(ctx, ex, ey, -Math.PI / 2)
        ctx.setLineDash([]); ctx.strokeStyle = '#475569'; ctx.lineWidth = 2
      } else {
        arrow(ctx, f.x + f.width, f.y + f.height / 2, t.x, t.y + t.height / 2)
      }
    })

    lm.forEach((body, lid) => {
      const lp = p[lid]; if (!lp || !body.length) return
      const fi = p[body[0]]
      if (fi) { ctx.strokeStyle = '#8b5cf6'; ctx.setLineDash([5, 5]); arrow(ctx, lp.x + lp.width / 2, lp.y + lp.height, fi.x + fi.width / 2, fi.y); ctx.setLineDash([]) }
      for (let i = 0; i < body.length - 1; i++) { const c = p[body[i]], n = p[body[i + 1]]; if (c && n) { ctx.strokeStyle = '#8b5cf6'; arrow(ctx, c.x + c.width, c.y + c.height / 2, n.x, n.y + n.height / 2) } }
      const la = p[body[body.length - 1]]
      if (la) {
        ctx.strokeStyle = '#f59e0b'; ctx.setLineDash([5, 5])
        const sx = la.x + la.width, sy = la.y + la.height / 2, ex = lp.x, ey = lp.y + lp.height / 2
        const cx = Math.max(sx, ex) + 60, cy = (sy + ey) / 2
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, sy, cx, cy); ctx.quadraticCurveTo(cx, ey, ex, ey); ctx.stroke()
        arrowHead(ctx, ex, ey, Math.PI); ctx.setLineDash([])
      }
    })

    nodes.forEach(node => {
      const pp = p[node.id]; if (!pp) return
      const st = ns[node.id], status = st?.status || 'pending', col = STATUS_COLORS[status] || STATUS_COLORS.pending
      ctx.fillStyle = sel === node.id ? '#334155' : '#1e293b'; ctx.strokeStyle = col; ctx.lineWidth = sel === node.id ? 3 : 2
      if (pp.isLoopBody) ctx.setLineDash([4, 4])
      rr(ctx, pp.x, pp.y, pp.width, pp.height, 8); ctx.fill(); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pp.x + 14, pp.y + pp.height / 2, 5, 0, Math.PI * 2); ctx.fill()
      if (status === 'running') { ctx.strokeStyle = 'rgba(59,130,246,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pp.x + 14, pp.y + pp.height / 2, 9, 0, Math.PI * 2); ctx.stroke() }
      ctx.fillStyle = '#f1f5f9'; ctx.font = '12px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
      const nm = node.name || node.id, ml = Math.floor((pp.width - 35) / 7)
      ctx.fillText(nm.length > ml ? nm.slice(0, ml - 2) + '...' : nm, pp.x + 26, pp.y + pp.height / 2 - 8)
      ctx.fillStyle = '#64748b'; ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif'
      let tt = node.type; if (st?.durationMs) tt += ` \u00b7 ${fmtDur(st.durationMs)}`
      ctx.fillText(tt, pp.x + 26, pp.y + pp.height / 2 + 10)
      if (node.type === 'loop') { ctx.fillStyle = '#8b5cf6'; ctx.fillText(`\u00d7${taskData.instance?.loopCounts?.[node.id] || 0}`, pp.x + pp.width - 25, pp.y + 14) }
      if (status === 'failed') { ctx.fillStyle = '#ef4444'; ctx.font = '14px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.fillText('!', pp.x + pp.width - 16, pp.y + pp.height / 2) }
    })
    ctx.restore()
  }, [taskData])

  const hit = useCallback((cx: number, cy: number) => {
    const cv = canvasRef.current; if (!cv) return null
    const r = cv.getBoundingClientRect()
    const x = (cx - r.left - pan.current.x) / scale.current, y = (cy - r.top - pan.current.y) / scale.current
    for (const [id, pp] of Object.entries(nodePos.current)) { if (x >= pp.x && x <= pp.x + pp.width && y >= pp.y && y <= pp.y + pp.height) return id }
    return null
  }, [])

  const showTip = useCallback((cx: number, cy: number, id: string) => {
    const tip = tipRef.current, co = contRef.current
    if (!tip || !co || !taskData?.workflow) return
    const nd = taskData.workflow.nodes.find(n => n.id === id)
    if (!nd) { tip.style.display = 'none'; return }
    const st = taskData.instance?.nodeStates?.[id], status = st?.status || 'pending'
    const cr = co.getBoundingClientRect()
    tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${nd.name || nd.id}</div><div style="color:#64748b">${nd.type}</div><div style="color:${STATUS_COLORS[status] || '#6b7280'};margin-top:4px">${status}</div>${st?.durationMs ? `<div style="color:#94a3b8">${fmtDur(st.durationMs)}</div>` : ''}`
    tip.style.display = 'block'
    let tx = cx - cr.left + 12, ty = cy - cr.top + 12
    if (tx + 200 > cr.width) tx = cx - cr.left - 200
    if (ty + 100 > cr.height) ty = cy - cr.top - 100
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px'
  }, [taskData])

  const hideTip = useCallback(() => { if (tipRef.current) tipRef.current.style.display = 'none' }, [])

  const animTo = useCallback((ns: number, nx: number, ny: number, dur = 250) => {
    if (anim.current) cancelAnimationFrame(anim.current)
    const ss = scale.current, sx = pan.current.x, sy = pan.current.y, t0 = performance.now()
    function step(now: number) {
      const t = Math.min((now - t0) / dur, 1), e = 1 - (1 - t) ** 3
      scale.current = ss + (ns - ss) * e; pan.current.x = sx + (nx - sx) * e; pan.current.y = sy + (ny - sy) * e
      draw(); if (t < 1) anim.current = requestAnimationFrame(step); else anim.current = null
    }
    anim.current = requestAnimationFrame(step)
  }, [draw])

  const fitView = useCallback(() => {
    const co = contRef.current, p = nodePos.current; if (!co || !Object.keys(p).length) return
    const r = co.getBoundingClientRect()
    let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity
    for (const v of Object.values(p)) { mx = Math.min(mx, v.x); my = Math.min(my, v.y); Mx = Math.max(Mx, v.x + v.width); My = Math.max(My, v.y + v.height) }
    if (mx === Infinity) return
    const pad = 40, ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((r.width - pad * 2) / (Mx - mx), (r.height - pad * 2) / (My - my))))
    animTo(ns, pad + ((r.width - pad * 2) - (Mx - mx) * ns) / 2 - mx * ns, pad + ((r.height - pad * 2) - (My - my) * ns) / 2 - my * ns, 350)
  }, [animTo])

  useEffect(() => {
    if (!taskData?.workflow) { nodePos.current = {}; prevWorkflowKey.current = null; draw(); return }
    const key = taskData.workflow.nodes.map(n => n.id).join(',') + '|' + (taskData.workflow.edges || []).map(e => e.from + '-' + e.to).join(',')
    const structureChanged = key !== prevWorkflowKey.current
    prevWorkflowKey.current = key
    const { pos, backEdges } = layoutNodes(taskData.workflow.nodes, taskData.workflow.edges)
    nodePos.current = pos
    backEdgesRef.current = backEdges
    draw()
    if (structureChanged) requestAnimationFrame(() => fitView())
  }, [taskData?.workflow, draw, fitView])

  useEffect(() => { draw() }, [selectedNodeId, draw])

  useEffect(() => {
    const co = contRef.current, cv = canvasRef.current; if (!co || !cv) return
    const md = (e: MouseEvent) => { if (e.target !== cv) return; const d = drag.current; d.on = true; d.moved = false; d.lx = e.clientX; d.ly = e.clientY; d.sx = e.clientX; d.sy = e.clientY; co.classList.add('dragging'); e.preventDefault() }
    const mm = (e: MouseEvent) => {
      const d = drag.current
      if (d.on) { pan.current.x += e.clientX - d.lx; pan.current.y += e.clientY - d.ly; d.lx = e.clientX; d.ly = e.clientY; if (Math.abs(e.clientX - d.sx) > DRAG_THRESHOLD || Math.abs(e.clientY - d.sy) > DRAG_THRESHOLD) d.moved = true; hideTip(); draw() }
      else { const h = hit(e.clientX, e.clientY); if (h) { showTip(e.clientX, e.clientY, h); co.style.cursor = 'pointer' } else { hideTip(); co.style.cursor = 'grab' } }
    }
    const mu = (e: MouseEvent) => { const d = drag.current; if (!d.on) return; d.on = false; co.classList.remove('dragging'); co.style.cursor = 'grab'; if (!d.moved) selectNode(hit(e.clientX, e.clientY)) }
    const wh = (e: WheelEvent) => {
      e.preventDefault(); if (anim.current) return
      const delta = e.ctrlKey ? -e.deltaY * 0.01 : (e.deltaY > 0 ? -0.08 : 0.08)
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.current * (1 + delta)))
      const rr = co.getBoundingClientRect(), mx = e.clientX - rr.left, my = e.clientY - rr.top
      pan.current.x = mx - (mx - pan.current.x) * (ns / scale.current); pan.current.y = my - (my - pan.current.y) * (ns / scale.current)
      scale.current = ns; draw()
    }
    const tdist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const ts = (e: TouchEvent) => {
      const t = touch.current
      if (e.touches.length === 1) { t.on = true; t.moved = false; t.sx = t.lx = e.touches[0].clientX; t.sy = t.ly = e.touches[0].clientY; co.classList.add('dragging') }
      else if (e.touches.length === 2) { t.on = false; t.dist = tdist(e.touches); t.mx = (e.touches[0].clientX + e.touches[1].clientX) / 2; t.my = (e.touches[0].clientY + e.touches[1].clientY) / 2 }
    }
    const tm = (e: TouchEvent) => {
      const t = touch.current
      if (e.touches.length === 1 && t.on) {
        pan.current.x += e.touches[0].clientX - t.lx; pan.current.y += e.touches[0].clientY - t.ly
        t.lx = e.touches[0].clientX; t.ly = e.touches[0].clientY
        if (Math.abs(e.touches[0].clientX - t.sx) > DRAG_THRESHOLD || Math.abs(e.touches[0].clientY - t.sy) > DRAG_THRESHOLD) t.moved = true
        hideTip(); draw(); e.preventDefault()
      } else if (e.touches.length === 2) {
        e.preventDefault(); const d = tdist(e.touches)
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.current * (d / t.dist)))
        const rr = co.getBoundingClientRect(), px = mx - rr.left, py = my - rr.top
        pan.current.x = px - (px - pan.current.x) * (ns / scale.current); pan.current.y = py - (py - pan.current.y) * (ns / scale.current)
        pan.current.x += mx - t.mx; pan.current.y += my - t.my
        scale.current = ns; t.dist = d; t.mx = mx; t.my = my; draw()
      }
    }
    const te = (e: TouchEvent) => { const t = touch.current; if (!e.touches.length) { co.classList.remove('dragging'); if (t.on && !t.moved) selectNode(hit(t.lx, t.ly)); t.on = false } else if (e.touches.length === 1) { t.on = true; t.lx = e.touches[0].clientX; t.ly = e.touches[0].clientY } }

    co.addEventListener('mousedown', md); document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
    co.addEventListener('wheel', wh, { passive: false })
    co.addEventListener('touchstart', ts, { passive: true }); co.addEventListener('touchmove', tm, { passive: false }); co.addEventListener('touchend', te, { passive: true })
    window.addEventListener('resize', draw); co.style.touchAction = 'none'
    return () => { co.removeEventListener('mousedown', md); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); co.removeEventListener('wheel', wh); co.removeEventListener('touchstart', ts); co.removeEventListener('touchmove', tm); co.removeEventListener('touchend', te); window.removeEventListener('resize', draw) }
  }, [draw, hit, showTip, hideTip, selectNode])

  const hasWf = !!taskData?.workflow
  const zoom = (f: number) => {
    const r = contRef.current?.getBoundingClientRect(); if (!r) return
    const cx = r.width / 2, cy = r.height / 2, ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.current * f))
    animTo(ns, cx - (cx - pan.current.x) * (ns / scale.current), cy - (cy - pan.current.y) * (ns / scale.current), 200)
  }

  return (
    <div className="main">
      {hasWf && (
        <>
          <div className="main-header">
            <div><h2>{taskData!.task.title}</h2><div className="task-id-label">{taskData!.task.id}</div></div>
            <div className="header-actions"><button className="btn" onClick={fitView}>Reset View</button></div>
          </div>
          <div className="toolbar">
            <div className="legend">
              <div className="legend-item"><div className="legend-dot dot-pending" /> Pending</div>
              <div className="legend-item"><div className="legend-dot dot-running" /> Running</div>
              <div className="legend-item"><div className="legend-dot dot-done" /> Done</div>
              <div className="legend-item"><div className="legend-dot dot-failed" /> Failed</div>
              <div className="legend-item"><div className="legend-dot dot-skipped" /> Skipped</div>
            </div>
            <div className="zoom-controls">
              <button className="zoom-btn" onClick={() => zoom(1.3)}>+</button>
              <button className="zoom-btn" onClick={() => zoom(1 / 1.3)}>-</button>
              <button className="zoom-btn fit" onClick={fitView}>Fit</button>
            </div>
          </div>
        </>
      )}
      {!hasWf && taskData && (
        <div className="main-header"><div><h2>{taskData.task.title}</h2><div className="task-id-label">{taskData.task.id}</div></div></div>
      )}
      <div className="canvas-container" ref={contRef}>
        {!taskData && <div className="no-selection">Select a task to view workflow</div>}
        {taskData && !hasWf && <div className="no-selection">No workflow generated yet</div>}
        <canvas ref={canvasRef} style={{ display: hasWf ? 'block' : 'none', position: 'absolute', top: 0, left: 0 }} />
        <div ref={tipRef} className="node-tooltip" style={{ display: 'none' }} />
      </div>
    </div>
  )
}
