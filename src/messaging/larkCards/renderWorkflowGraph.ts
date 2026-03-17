/**
 * Render workflow DAG as PNG image using @napi-rs/canvas
 *
 * Layout: topological BFS layers, start at top, end at bottom.
 * Node colors by status: done=green, failed=red, running=blue, pending=grey, skipped=yellow.
 */

import type { Workflow, WorkflowInstance } from '../../types/workflow.js'
import { createLogger } from '../../shared/logger.js'

const logger = createLogger('render-workflow-graph')

// ── Constants ──

const CANVAS_WIDTH = 800
const NODE_W = 140
const NODE_H = 40
const LAYER_GAP_Y = 80
const NODE_GAP_X = 20
const PADDING_TOP = 40
const PADDING_BOTTOM = 40
const RADIUS = 8

const STATUS_COLORS: Record<string, string> = {
  done: '#4CAF50',
  completed: '#4CAF50',
  failed: '#F44336',
  running: '#2196F3',
  pending: '#9E9E9E',
  ready: '#2196F3',
  waiting: '#FF9800',
  skipped: '#FF9800',
}

const STATUS_EMOJI: Record<string, string> = {
  done: '✅',
  completed: '✅',
  failed: '❌',
  running: '🔄',
  pending: '⏳',
  ready: '🔵',
  waiting: '⏳',
  skipped: '⏭️',
}

interface NodeLayout {
  id: string
  name: string
  status: string
  x: number
  y: number
}

export interface RenderResult {
  type: 'image'
  buffer: Buffer
}

/**
 * Render workflow topology as PNG buffer.
 * Returns null if node count <= 2 or canvas is unavailable.
 */
export async function renderWorkflowGraph(
  workflow: Workflow,
  instance: WorkflowInstance
): Promise<RenderResult | null> {
  if (workflow.nodes.length <= 2) return null

  try {
    const { createCanvas, GlobalFonts: globalFonts } = await import('@napi-rs/canvas')

    // Register Chinese font for CJK text rendering
    if (!globalFonts.has('CJK')) {
      const fontPaths = [
        '/System/Library/Fonts/PingFang.ttc',                    // macOS
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', // Linux (Debian/Ubuntu)
        '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',     // Linux (Arch/Fedora)
      ]
      for (const fp of fontPaths) {
        try {
          globalFonts.registerFromPath(fp, 'CJK')
          break
        } catch { /* try next */ }
      }
    }

    // Build adjacency from edges
    const adj = new Map<string, string[]>()
    const inDegree = new Map<string, number>()
    const loopEdges = new Set<string>() // "from->to" for dashed lines

    for (const node of workflow.nodes) {
      adj.set(node.id, [])
      inDegree.set(node.id, 0)
    }

    for (const edge of workflow.edges) {
      if (edge.maxLoops != null && edge.maxLoops > 0) {
        loopEdges.add(`${edge.from}->${edge.to}`)
        // Skip loop-back edges for topological sort
        continue
      }
      adj.get(edge.from)?.push(edge.to)
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    }

    // BFS topological layering
    const layers: string[][] = []
    const queue: string[] = []
    const layerOf = new Map<string, number>()

    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    while (queue.length > 0) {
      const nextQueue: string[] = []
      const layer: string[] = []
      for (const id of queue) {
        layer.push(id)
        layerOf.set(id, layers.length)
        for (const to of adj.get(id) ?? []) {
          const newDeg = (inDegree.get(to) ?? 1) - 1
          inDegree.set(to, newDeg)
          if (newDeg === 0) nextQueue.push(to)
        }
      }
      layers.push(layer)
      queue.length = 0
      queue.push(...nextQueue)
    }

    // Place orphan nodes (in cycles) into last layer
    for (const node of workflow.nodes) {
      if (!layerOf.has(node.id)) {
        if (layers.length === 0) layers.push([])
        layers[layers.length - 1]!.push(node.id)
        layerOf.set(node.id, layers.length - 1)
      }
    }

    // Compute layout positions
    const canvasHeight = PADDING_TOP + layers.length * (NODE_H + LAYER_GAP_Y) - LAYER_GAP_Y + PADDING_BOTTOM
    const nodeMap = new Map<string, NodeLayout>()
    const nameMap = new Map<string, string>()
    for (const n of workflow.nodes) nameMap.set(n.id, n.name)

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li]!
      const totalW = layer.length * NODE_W + (layer.length - 1) * NODE_GAP_X
      const startX = (CANVAS_WIDTH - totalW) / 2
      const y = PADDING_TOP + li * (NODE_H + LAYER_GAP_Y)

      for (let ni = 0; ni < layer.length; ni++) {
        const id = layer[ni]!
        const status = instance.nodeStates[id]?.status ?? 'pending'
        nodeMap.set(id, {
          id,
          name: nameMap.get(id) ?? id,
          status,
          x: startX + ni * (NODE_W + NODE_GAP_X),
          y,
        })
      }
    }

    // Create canvas and draw
    const canvas = createCanvas(CANVAS_WIDTH, canvasHeight)
    const ctx = canvas.getContext('2d')

    // Background
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight)

    // Draw edges first (behind nodes)
    for (const edge of workflow.edges) {
      const from = nodeMap.get(edge.from)
      const to = nodeMap.get(edge.to)
      if (!from || !to) continue

      const fromX = from.x + NODE_W / 2
      const fromY = from.y + NODE_H
      const toX = to.x + NODE_W / 2
      const toY = to.y

      const isLoop = loopEdges.has(`${edge.from}->${edge.to}`)

      ctx.strokeStyle = isLoop ? '#666' : '#888'
      ctx.lineWidth = isLoop ? 1.5 : 2
      ctx.beginPath()

      if (isLoop) {
        ctx.setLineDash([6, 4])
      } else {
        ctx.setLineDash([])
      }

      if (isLoop && fromY >= toY) {
        // Loop-back: draw curve to the right
        const curveOffset = 30
        ctx.moveTo(fromX, fromY)
        ctx.bezierCurveTo(
          fromX + curveOffset + 40, fromY + 30,
          toX + curveOffset + 40, toY - 30,
          toX, toY
        )
      } else {
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
      }

      ctx.stroke()
      ctx.setLineDash([])

      // Arrowhead
      const angle = Math.atan2(toY - fromY, toX - fromX)
      const arrowLen = 8
      ctx.fillStyle = isLoop ? '#666' : '#888'
      ctx.beginPath()
      ctx.moveTo(toX, toY)
      ctx.lineTo(
        toX - arrowLen * Math.cos(angle - Math.PI / 6),
        toY - arrowLen * Math.sin(angle - Math.PI / 6)
      )
      ctx.lineTo(
        toX - arrowLen * Math.cos(angle + Math.PI / 6),
        toY - arrowLen * Math.sin(angle + Math.PI / 6)
      )
      ctx.closePath()
      ctx.fill()
    }

    // Draw nodes
    for (const node of nodeMap.values()) {
      const color = STATUS_COLORS[node.status] ?? '#9E9E9E'
      const emoji = STATUS_EMOJI[node.status] ?? '❓'

      // Rounded rectangle
      ctx.fillStyle = color + '30' // semi-transparent fill
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(node.x, node.y, NODE_W, NODE_H, RADIUS)
      ctx.fill()
      ctx.stroke()

      // Text
      ctx.fillStyle = '#ffffff'
      ctx.font = globalFonts.has('CJK') ? '13px CJK' : '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const label = truncateText(node.name, 12)
      ctx.fillText(`${emoji} ${label}`, node.x + NODE_W / 2, node.y + NODE_H / 2)
    }

    const buffer = canvas.toBuffer('image/png')
    return { type: 'image', buffer: Buffer.from(buffer) }
  } catch (err) {
    logger.warn(`Failed to render workflow graph: ${err}`)
    return null
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}
