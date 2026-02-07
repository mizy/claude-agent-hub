import { useStore } from '../store/useStore'

export function TimelineTab() {
  const timelineLogs = useStore((s) => s.timelineLogs)

  if (!timelineLogs.length) {
    return <div className="empty-state">No timeline events</div>
  }

  return (
    <div className="log-viewer">
      {timelineLogs.map((log, i) => {
        const time = new Date(log.timestamp).toLocaleTimeString('zh-CN')
        const cls = log.event.includes('failed') ? 'log-error' : log.event.includes('completed') ? 'log-success' : 'log-info'
        return (
          <div key={i} className="log-line">
            <span className="log-time">[{time}]</span>{' '}
            <span className={cls}>{log.event}</span>
            {log.nodeId && ` - ${log.nodeName || log.nodeId}`}
          </div>
        )
      })}
    </div>
  )
}
