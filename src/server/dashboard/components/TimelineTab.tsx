import { useStore } from '../store/useStore'

const EVENT_STYLES: Record<string, { color: string; icon: string }> = {
  'workflow:started':   { color: '#818cf8', icon: '▶' },
  'workflow:completed': { color: '#818cf8', icon: '✓' },
  'workflow:failed':    { color: '#ef4444', icon: '✗' },
  'node:started':      { color: '#3b82f6', icon: '●' },
  'node:completed':    { color: '#22c55e', icon: '✓' },
  'node:failed':       { color: '#ef4444', icon: '✗' },
  'node:skipped':      { color: '#eab308', icon: '○' },
}

function getEventStyle(event: string) {
  for (const [key, style] of Object.entries(EVENT_STYLES)) {
    if (event.includes(key.split(':')[1]) && event.includes(key.split(':')[0])) return style
  }
  if (event.includes('failed') || event.includes('error')) return { color: '#ef4444', icon: '✗' }
  if (event.includes('completed') || event.includes('done')) return { color: '#22c55e', icon: '✓' }
  if (event.includes('started') || event.includes('running')) return { color: '#3b82f6', icon: '▶' }
  if (event.includes('workflow')) return { color: '#818cf8', icon: '◆' }
  return { color: '#6b7280', icon: '●' }
}

export function TimelineTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const timelineLogs = useStore((s) => s.timelineLogs)

  if (!selectedTaskId) {
    return <div className="empty-state">Select a task to view timeline</div>
  }

  if (!timelineLogs.length) {
    return <div className="empty-state">No timeline events</div>
  }

  // Build duration map: for each node, find start→complete duration
  const nodeDurations: Record<string, { startTime: number; endTime: number }> = {}
  for (const log of timelineLogs) {
    if (!log.nodeId) continue
    if (log.event.includes('started')) {
      nodeDurations[log.nodeId] = { startTime: new Date(log.timestamp).getTime(), endTime: 0 }
    } else if ((log.event.includes('completed') || log.event.includes('failed')) && nodeDurations[log.nodeId]) {
      nodeDurations[log.nodeId].endTime = new Date(log.timestamp).getTime()
    }
  }

  const firstTs = new Date(timelineLogs[0].timestamp).getTime()

  // Find max duration for bar scaling
  const maxDur = Object.values(nodeDurations).reduce((max, d) => {
    if (d.endTime > 0) return Math.max(max, d.endTime - d.startTime)
    return max
  }, 1)

  return (
    <div className="timeline-view">
      {timelineLogs.map((log, i) => {
        const time = new Date(log.timestamp).toLocaleTimeString('zh-CN')
        const elapsed = new Date(log.timestamp).getTime() - firstTs
        const elapsedStr = elapsed < 1000 ? `+${elapsed}ms` : elapsed < 60000 ? `+${(elapsed / 1000).toFixed(1)}s` : `+${(elapsed / 60000).toFixed(1)}m`
        const style = getEventStyle(log.event)
        const dur = log.nodeId && nodeDurations[log.nodeId]
        const showDur = dur && dur.endTime > 0 && (log.event.includes('completed') || log.event.includes('failed'))
        const durMs = showDur ? dur.endTime - dur.startTime : 0
        const durStr = durMs < 1000 ? `${durMs}ms` : durMs < 60000 ? `${(durMs / 1000).toFixed(1)}s` : `${(durMs / 60000).toFixed(1)}m`
        const durPct = showDur ? Math.max(8, (durMs / maxDur) * 100) : 0

        return (
          <div key={i} className="tl-event">
            <div className="tl-gutter">
              <div className="tl-time">{time}</div>
              <div className="tl-elapsed">{elapsedStr}</div>
            </div>
            <div className="tl-indicator">
              <div className="tl-dot" style={{ background: style.color }}>{style.icon}</div>
              {i < timelineLogs.length - 1 && <div className="tl-line" />}
            </div>
            <div className="tl-content">
              <div className="tl-event-name" style={{ color: style.color }}>{log.event}</div>
              {log.nodeId && <div className="tl-node-name">{log.nodeName || log.nodeId}</div>}
              {showDur && (
                <div className="tl-dur-row">
                  <div className="tl-dur-bar" style={{ width: `${durPct}%`, background: style.color }} />
                  <span className="tl-duration">{durStr}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
