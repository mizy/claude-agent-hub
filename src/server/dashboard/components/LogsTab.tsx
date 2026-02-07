import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { fetchApi } from '../api/fetchApi'

export function LogsTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const [logs, setLogs] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const loadLogs = async () => {
    if (!selectedTaskId) return
    const res = await fetchApi<{ logs: string }>(`/api/tasks/${selectedTaskId}/logs?tail=200`)
    if (res?.logs) {
      setLogs(res.logs)
      // Auto-scroll to bottom
      requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight })
    }
  }

  useEffect(() => { loadLogs() }, [selectedTaskId])

  if (!selectedTaskId) return <div className="empty-state">Select a task to view logs</div>

  return (
    <div style={{ height: '100%' }}>
      <div className="exec-log-toolbar">
        <span className="label">Execution Log</span>
        <button className="btn" onClick={loadLogs} style={{ fontSize: 11, padding: '3px 8px' }}>Refresh</button>
      </div>
      <div className="exec-log-viewer" ref={logRef}>{logs || '(no logs available)'}</div>
    </div>
  )
}
