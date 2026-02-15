import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { fetchApi } from '../api/fetchApi'

export function LogsTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const taskData = useStore((s) => s.taskData)
  const activeTab = useStore((s) => s.activeTab)
  const [logs, setLogs] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  const isRunning = taskData?.task && ['developing', 'planning', 'reviewing'].includes(taskData.task.status)

  const loadLogs = useCallback(async () => {
    if (!selectedTaskId) return
    const res = await fetchApi<{ logs: string }>(`/api/tasks/${selectedTaskId}/logs?tail=200`)
    if (res?.logs) {
      setLogs(res.logs)
      requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight })
    }
  }, [selectedTaskId])

  useEffect(() => { loadLogs() }, [loadLogs])

  // Auto-refresh logs every 3s when task is running and tab is active
  useEffect(() => {
    if (!autoRefresh || !isRunning || activeTab !== 'logs') return
    const timer = setInterval(loadLogs, 3000)
    return () => clearInterval(timer)
  }, [autoRefresh, isRunning, activeTab, loadLogs])

  if (!selectedTaskId) return <div className="empty-state">Select a task to view logs</div>

  return (
    <div style={{ height: '100%' }}>
      <div className="exec-log-toolbar">
        <span className="label">Execution Log {isRunning && autoRefresh && <span style={{ color: '#22c55e', fontSize: 10 }}> (live)</span>}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isRunning && (
            <label style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto
            </label>
          )}
          <button className="btn" onClick={loadLogs} style={{ fontSize: 11, padding: '3px 8px' }}>Refresh</button>
        </div>
      </div>
      <div className="exec-log-viewer" ref={logRef}>{logs || '(no logs available)'}</div>
    </div>
  )
}
