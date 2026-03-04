/** Custom mmeditor node shape for workflow visualization */

const FONT = '-apple-system,BlinkMacSystemFont,sans-serif'

export const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  skipped: '#eab308',
}

const TYPE_ICONS: Record<string, string> = {
  start: '\u25B6',
  end: '\u25A0',
  task: '\u2699',
  script: '\u27A4',
  foreach: '\u21BB',
  loop: '\u21BB',
  'schedule-wait': '\u23F0',
  'lark-notify': '\u2709',
}

export function fmtDur(ms: number) {
  ms = Math.max(0, ms)
  return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`
}

function createSvgEl(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

export const workflowNodeShape = {
  adsorb: [20, 20] as [number, number],
  linkPoints: [
    { x: 0, y: 0.5 },   // left
    { x: 1, y: 0.5 },   // right
    { x: 0.5, y: 0 },   // top
    { x: 0.5, y: 1 },   // bottom
  ],
  render: (instanceNode: { data: Record<string, unknown>; shape?: SVGElement }) => {
    const { data } = instanceNode
    if (instanceNode.shape) instanceNode.shape.remove()

    const w = (data.width as number) || 220
    const h = (data.height as number) || 64
    const status = (data.status as string) || 'pending'
    const nodeType = (data.nodeType as string) || 'task'
    const name = (data.name as string) || ''
    const durationMs = data.durationMs as number | undefined
    const isLoopBody = !!data.isLoopBody
    const color = STATUS_COLORS[status] || STATUS_COLORS.pending
    const icon = TYPE_ICONS[nodeType] || '\u2022'

    const g = createSvgEl('g')

    // Background rect
    const rect = createSvgEl('rect', {
      x: '0', y: '0',
      width: String(w), height: String(h),
      rx: '8', ry: '8',
      fill: '#1e293b',
      stroke: color,
      'stroke-width': '2',
    })
    if (isLoopBody) rect.setAttribute('stroke-dasharray', '4 4')
    g.appendChild(rect)

    // Status dot
    const dot = createSvgEl('circle', {
      cx: '14', cy: String(h / 2),
      r: '5', fill: color,
    })
    g.appendChild(dot)

    // Running pulse ring
    if (status === 'running') {
      const pulse = createSvgEl('circle', {
        cx: '14', cy: String(h / 2),
        r: '9', fill: 'none',
        stroke: STATUS_COLORS.running,
        opacity: '0.4',
        'stroke-width': '2',
        class: 'wf-pulse',
      })
      g.appendChild(pulse)
    }

    // Icon
    const iconEl = createSvgEl('text', {
      x: '26', y: String(h / 2 - 6),
      fill: '#94a3b8',
      'font-size': '13',
      'dominant-baseline': 'middle',
      'font-family': FONT,
    })
    iconEl.textContent = icon
    g.appendChild(iconEl)

    // Name text
    const maxChars = Math.floor((w - 50) / 10) // ~10px avg for CJK+ASCII mix
    const displayName = name.length > maxChars ? name.slice(0, maxChars - 2) + '...' : name
    const nameEl = createSvgEl('text', {
      x: '40', y: String(h / 2 - 6),
      fill: '#f1f5f9',
      'font-size': '13',
      'font-weight': '500',
      'dominant-baseline': 'middle',
      'font-family': FONT,
    })
    nameEl.textContent = displayName
    g.appendChild(nameEl)

    // Subtext: type + duration
    let subtext = nodeType
    if (durationMs) subtext += ` \u00b7 ${fmtDur(durationMs)}`
    const subEl = createSvgEl('text', {
      x: '40', y: String(h / 2 + 14),
      fill: '#64748b',
      'font-size': '11',
      'dominant-baseline': 'middle',
      'font-family': FONT,
    })
    subEl.textContent = subtext
    g.appendChild(subEl)

    // Failed indicator
    if (status === 'failed') {
      const failEl = createSvgEl('text', {
        x: String(w - 16), y: String(h / 2),
        fill: '#ef4444',
        'font-size': '14',
        'dominant-baseline': 'middle',
        'text-anchor': 'middle',
        'font-family': FONT,
      })
      failEl.textContent = '!'
      g.appendChild(failEl)
    }

    // Loop count badge
    if (nodeType === 'loop' && data.loopCount) {
      const badgeEl = createSvgEl('text', {
        x: String(w - 25), y: '14',
        fill: '#8b5cf6',
        'font-size': '10',
        'font-family': FONT,
      })
      badgeEl.textContent = `\u00d7${data.loopCount}`
      g.appendChild(badgeEl)
    }

    return g
  },
}
