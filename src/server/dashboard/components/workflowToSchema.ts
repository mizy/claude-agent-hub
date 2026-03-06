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
}

const EDGE_COLORS: Record<string, string> = {
  pending: 'rgba(107,114,128,0.4)',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  skipped: '#eab308',
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

/** Return a minimal icon label for a condition edge; full text shown on hover */
function summarizeCondition(cond?: string): string | null {
  if (!cond) return null
  return cond.startsWith('!') ? '✗' : '✓'
}

/** Convert workflow data to mmeditor schema format */
export function workflowToSchema(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  instance: Instance | null,
  taskDone = false,
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

  const schemaNodes: WfNodeData[] = nodes.map(n => {
    const st = ns[n.id]
    let status = STATUS_MAP[st?.status || 'pending'] || 'pending'
    if (taskDone && status === 'pending') status = 'skipped'
    const loopInfo = loopMap.get(n.id)
    return {
      uuid: n.id,
      type: 'wf-node',
      name: n.name || n.id,
      x: 0, y: 0,
      width: NODE_W, height: NODE_H,
      nodeType: n.type,
      status,
      agent: n.task?.persona,
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

  function edgeStatus(fromId: string, toId: string): string {
    const fromSt = nodeStatusMap.get(fromId) || 'pending'
    const toSt = nodeStatusMap.get(toId) || 'pending'
    if (toSt === 'running') return 'running'
    if (fromSt === 'failed') return 'failed'
    if (fromSt === 'completed') return 'completed'
    if (fromSt === 'skipped') return 'skipped'
    return 'pending'
  }

  const schemaLines: WfLineData[] = edges.map(e => {
    const isBack = backEdges.has(`${e.from}->${e.to}`)
    const st = edgeStatus(e.from, e.to)
    const curLoops = loopCounts[e.id]
    const classes = ['ve-edge', `ve-edge-${st}`, ...(isBack ? ['ve-back-edge'] : []), ...(st === 'running' ? ['running'] : [])].join(' ')
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
      style: { stroke: EDGE_COLORS[st] || EDGE_COLORS.pending },
      label: [summarizeCondition(e.condition), curLoops != null && e.maxLoops ? `${curLoops}/${e.maxLoops}` : null].filter(Boolean).join(' ') || undefined,
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
      fromPoint: LP.right, toPoint: LP.left,
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
      fromPoint: LP.left, toPoint: LP.left,
      isBackEdge: true,
      className: ['ve-back-edge', ...(backSt === 'running' ? ['running'] : [])].join(' '),
      style: { stroke: EDGE_COLORS[backSt] || EDGE_COLORS.pending },
      curLoops,
      maxLoops: maxIterations,
      label: curLoops != null && maxIterations ? `${curLoops}/${maxIterations}` : undefined,
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
