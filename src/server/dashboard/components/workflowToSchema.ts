import dagre from 'dagre'
import type { WorkflowNode, WorkflowEdge, Instance } from '../store/useStore'

export interface WfNodeData {
  uuid: string
  type: string
  name: string
  x: number
  y: number
  width: number
  height: number
  nodeType: string
  status: string
  agent?: string
  model?: string
  backend?: string
  durationMs?: number
  error?: string
  isLoopBody?: boolean
  loopId?: string
  loopCount?: number
  maxIterations?: number
  className?: string
  [key: string]: unknown
}

export interface WfLineData {
  uuid: string
  from: string
  to: string
  fromPoint: number
  toPoint: number
  condition?: string
  label?: string
  labelKind?: string
  status?: EdgeVisualStatus
  maxLoops?: number
  curLoops?: number
  isBackEdge?: boolean
  className?: string
  [key: string]: unknown
}

export interface WfSchemaData {
  nodes: WfNodeData[]
  lines: WfLineData[]
}

/** Link point indices matching workflowNodeShape.linkPoints array order */
const LP = { left: 0, right: 1, top: 2, bottom: 3 } as const

const STATUS_MAP: Record<string, string> = {
  pending: 'pending', ready: 'pending',
  running: 'running', waiting: 'running',
  done: 'completed', completed: 'completed', // "done" from legacy nodeStates
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'skipped',
  stopped: 'skipped',
}

const EDGE_COLORS: Record<string, string> = {
  pending: 'rgba(107,114,128,0.4)',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  skipped: '#eab308',
  'loop-completed': '#a78bfa',
}

/** Detect back-edges via DFS to handle cycles in layout */
function findBackEdges(nodeIds: string[], adj: Record<string, string[]>): Set<string> {
  const backEdges = new Set<string>()
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color: Record<string, number> = {}
  nodeIds.forEach(id => { color[id] = WHITE })
  function dfs(u: string) {
    color[u] = GRAY
    for (const v of (adj[u] || [])) {
      if (color[v] === GRAY) backEdges.add(`${u}->${v}`)
      else if (color[v] === WHITE) dfs(v)
    }
    color[u] = BLACK
  }
  nodeIds.forEach(id => { if (color[id] === WHITE) dfs(id) })
  return backEdges
}

function isNegativeCondition(cond?: string): boolean {
  return !!cond && /^\s*!|^\s*not\s/i.test(cond)
}

type EdgeLabelKind = 'condition' | 'condition-negative' | 'else' | 'loop' | 'neutral'
type EdgeVisualStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

function getEdgeLabelKind(
  e: WorkflowEdge,
  isBack: boolean,
  isImplicitElse: boolean,
  isNegative: boolean,
): EdgeLabelKind {
  if (isBack) return 'loop'
  if (isImplicitElse) return 'else'
  if (isNegative) return 'condition-negative'
  if (e.condition) return 'condition'
  return 'neutral'
}

/** Build a human-readable label for an edge */
function buildEdgeLabel(kind: EdgeLabelKind, curLoops?: number, maxLoops?: number): string | undefined {
  if (kind === 'loop') {
    return maxLoops ? `loop ${curLoops ?? 0}/${maxLoops}` : 'loop'
  }
  if (kind === 'else') return 'else'
  if (kind === 'condition-negative') return 'if not'
  if (kind === 'condition') return 'if'
  return undefined
}

/** Convert workflow data to mmeditor schema format */
export function workflowToSchema(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  instance: Instance | null,
  taskTerminal = false,
  taskModel?: string,
  taskBackend?: string,
): WfSchemaData {
  const ns = instance?.nodeStates || {}
  const loopCounts = instance?.loopCounts || {}

  // Identify loop body nodes
  const loopMap = new Map<string, { bodyNodes: string[]; maxIterations?: number }>()
  const bodySet = new Set<string>()
  nodes.forEach(n => {
    const bodyNodes = n.loop?.bodyNodes ?? n.config?.bodyNodes
    const maxIterations = n.loop?.maxIterations ?? n.config?.maxIterations
    if (n.type === 'loop' && bodyNodes) {
      loopMap.set(n.id, { bodyNodes, maxIterations })
      bodyNodes.forEach((id: string) => bodySet.add(id))
    }
  })

  // Reverse map: bodyNodeId → loopId
  const bodyToLoop = new Map<string, string>()
  loopMap.forEach((v, loopId) => v.bodyNodes.forEach(id => bodyToLoop.set(id, loopId)))

  // Build adjacency for back-edge detection (main nodes only)
  const mainIds = nodes.filter(n => !bodySet.has(n.id)).map(n => n.id)
  const adj: Record<string, string[]> = {}
  mainIds.forEach(id => { adj[id] = [] })
  edges.forEach(e => {
    if (!bodySet.has(e.from) && !bodySet.has(e.to) && adj[e.from])
      adj[e.from].push(e.to)
  })
  const backEdges = findBackEdges(mainIds, adj)

  const NODE_W = 220, NODE_H = 64

  // Build set of nodes that participated in executed loops
  const loopExecutedNodes = new Set<string>()
  edges.forEach(e => {
    const key = `${e.from}->${e.to}`
    if (backEdges.has(key) && (loopCounts[e.id] ?? 0) > 0) {
      loopExecutedNodes.add(e.from)
    }
  })
  loopMap.forEach(({ bodyNodes }, loopId) => {
    if ((loopCounts[loopId] ?? 0) > 0) {
      bodyNodes.forEach(id => loopExecutedNodes.add(id))
    }
  })

  const schemaNodes: WfNodeData[] = nodes.map(n => {
    const st = ns[n.id]
    let status = STATUS_MAP[st?.status || 'pending'] || 'pending'
    if (taskTerminal && status === 'pending') {
      // Nodes that participated in a loop iteration → mark completed (they did run)
      // Nodes never reached → mark skipped
      status = loopExecutedNodes.has(n.id) ? 'completed' : 'skipped'
    }
    const loopInfo = loopMap.get(n.id)
    return {
      uuid: n.id,
      type: 'wf-node',
      name: n.name || n.id,
      x: 0, y: 0,
      width: NODE_W, height: NODE_H,
      nodeType: n.type,
      status,
      agent: n.task?.agent,
      model: n.task?.model || n.config?.model || (!(n.task?.backend || n.config?.backend) ? taskModel : undefined),
      backend: n.task?.backend || n.config?.backend || taskBackend,
      durationMs: st?.durationMs,
      error: st?.error,
      isLoopBody: bodySet.has(n.id),
      loopId: bodyToLoop.get(n.id),
      loopCount: loopCounts[n.id],
      maxIterations: loopInfo?.maxIterations,
      className: `wf-status-${status}`,
    }
  })

  // Build nodeStatus map for edge styling
  const nodeStatusMap = new Map<string, string>()
  schemaNodes.forEach(n => nodeStatusMap.set(n.uuid, n.status))

  function edgeStatus(fromId: string, toId: string): EdgeVisualStatus {
    const fromSt = nodeStatusMap.get(fromId) || 'pending'
    const toSt = nodeStatusMap.get(toId) || 'pending'
    if (toSt === 'running') return 'running'
    if (toSt === 'failed' || fromSt === 'failed') return 'failed'
    if (toSt === 'completed') return 'completed'
    // A skipped target usually means the branch never ran, so keep pending visuals.
    if (toSt === 'skipped') return 'pending'
    if (fromSt === 'completed') return 'completed'
    if (fromSt === 'skipped') return 'pending'
    return 'pending'
  }

  // Detect nodes with multiple outgoing condition edges — spread them to avoid label overlap
  const conditionEdgesByFrom = new Map<string, WorkflowEdge[]>()
  edges.forEach(e => {
    if (e.condition && !backEdges.has(`${e.from}->${e.to}`)) {
      if (!conditionEdgesByFrom.has(e.from)) conditionEdgesByFrom.set(e.from, [])
      conditionEdgesByFrom.get(e.from)!.push(e)
    }
  })
  // For nodes with 2+ condition edges: positive condition exits bottom, negative exits right
  const negativeConditionEdges = new Set<string>()
  conditionEdgesByFrom.forEach(condEdges => {
    if (condEdges.length >= 2) {
      condEdges.filter(e => isNegativeCondition(e.condition)).forEach(e => negativeConditionEdges.add(e.id))
    }
  })

  // Detect implicit "else" edges: no condition, but sibling edges from same node have conditions
  // Include back-edges too — e.g. verify→fix (loop-back, no condition) alongside verify→report (APPROVED condition)
  const implicitElseEdges = new Set<string>()
  const nodesWithCondEdges = new Set(conditionEdgesByFrom.keys())
  edges.forEach(e => {
    if (!e.condition && nodesWithCondEdges.has(e.from)) {
      implicitElseEdges.add(e.id)
      if (!backEdges.has(`${e.from}->${e.to}`)) {
        negativeConditionEdges.add(e.id)
      }
    }
  })

  const schemaLines: WfLineData[] = edges.map(e => {
    const isBack = backEdges.has(`${e.from}->${e.to}`)
    const st = edgeStatus(e.from, e.to)
    const curLoops = loopCounts[e.id]
    const isElse = implicitElseEdges.has(e.id)
    const isNegative = isNegativeCondition(e.condition) || negativeConditionEdges.has(e.id)
    const labelKind = getEdgeLabelKind(e, isBack, isElse, isNegative)
    const label = e.label || buildEdgeLabel(labelKind, curLoops, e.maxLoops)
    const classes = [
      've-edge',
      `ve-edge-${st}`,
      ...(label ? ['ve-label', `ve-label-status-${st}`, `ve-label-kind-${labelKind}`] : []),
      ...(isBack ? ['ve-back-edge'] : []),
      ...(st === 'running' ? ['running'] : []),
    ].join(' ')
    return {
      uuid: e.id,
      from: e.from,
      to: e.to,
      fromPoint: isBack ? LP.right : LP.bottom,
      toPoint: isBack ? LP.right : LP.top,
      condition: e.condition,
      maxLoops: e.maxLoops,
      curLoops,
      isBackEdge: isBack,
      className: classes,
      status: st,
      labelKind,
      style: { stroke: EDGE_COLORS[st] || EDGE_COLORS.pending },
      label,
    }
  })

  // Add loop body edges (loop→first body, body chain, last body→loop)
  loopMap.forEach(({ bodyNodes, maxIterations }, loopId) => {
    if (!bodyNodes.length) return
    // loop → first body (purple dashed)
    const enterSt = edgeStatus(loopId, bodyNodes[0])
    schemaLines.push({
      uuid: `loop-enter-${loopId}`,
      from: loopId, to: bodyNodes[0],
      fromPoint: LP.bottom, toPoint: LP.top,
      className: ['ve-loop-edge', ...(enterSt === 'running' ? ['running'] : [])].join(' '),
      style: { stroke: EDGE_COLORS[enterSt] || EDGE_COLORS.pending },
    })
    // body chain
    for (let i = 0; i < bodyNodes.length - 1; i++) {
      const bodySt = edgeStatus(bodyNodes[i], bodyNodes[i + 1])
      schemaLines.push({
        uuid: `loop-body-${loopId}-${i}`,
        from: bodyNodes[i], to: bodyNodes[i + 1],
        fromPoint: LP.bottom, toPoint: LP.top,
        className: ['ve-loop-body-edge', ...(bodySt === 'running' ? ['running'] : [])].join(' '),
        style: { stroke: EDGE_COLORS[bodySt] || EDGE_COLORS.pending },
      })
    }
    // last body → loop (amber dashed back-flow)
    const backSt = edgeStatus(bodyNodes[bodyNodes.length - 1], loopId)
    const curLoops = loopCounts[loopId]
    schemaLines.push({
      uuid: `loop-back-${loopId}`,
      from: bodyNodes[bodyNodes.length - 1], to: loopId,
      fromPoint: LP.right, toPoint: LP.right,
      isBackEdge: true,
      className: ['ve-edge', `ve-edge-${backSt}`, 've-label', `ve-label-status-${backSt}`, 've-label-kind-loop', 've-back-edge', ...(backSt === 'running' ? ['running'] : [])].join(' '),
      style: { stroke: EDGE_COLORS[backSt] || EDGE_COLORS.pending },
      curLoops,
      maxLoops: maxIterations,
      status: backSt,
      labelKind: 'loop',
      label: buildEdgeLabel('loop', curLoops, maxIterations),
    })
  })

  // Pre-compute layout with dagre
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 100, align: 'UL' })
  g.setDefaultEdgeLabel(() => ({}))
  schemaNodes.forEach(n => g.setNode(n.uuid, { width: n.width, height: n.height }))
  // Skip back-edges for layout to avoid cycle issues
  schemaLines.forEach(l => {
    if (!l.isBackEdge) g.setEdge(l.from, l.to)
  })
  dagre.layout(g)
  const nodeMap = new Map(schemaNodes.map(n => [n.uuid, n]))
  g.nodes().forEach(id => {
    const pos = g.node(id)
    const node = nodeMap.get(id)
    if (node && pos) {
      // dagre centers nodes, shift to top-left origin
      node.x = pos.x - pos.width / 2
      node.y = pos.y - pos.height / 2
    }
  })

  return { nodes: schemaNodes, lines: schemaLines }
}
