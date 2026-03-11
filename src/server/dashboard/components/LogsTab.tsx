import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { fetchApi } from '../api/fetchApi'

export function LogsTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const selectNode = useStore((s) => s.selectNode)
  const taskData = useStore((s) => s.taskData)
  const activeTab = useStore((s) => s.activeTab)
  const [logs, setLogs] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  const isRunning = taskData?.task && ['developing', 'planning', 'reviewing'].includes(taskData.task.status)

  // Find node name from selectedNodeId for API filtering
  const selectedNodeName = selectedNodeId
    ? (taskData?.workflow?.nodes as Array<{ id: string; name?: string }> | undefined)
        ?.find(n => n.id === selectedNodeId)?.name ?? selectedNodeId
    : null

  const loadLogs = useCallback(async () => {
    if (!selectedTaskId) {
      setLogs('')
      return
    }
    const params = new URLSearchParams({ tail: '500' })
    if (selectedNodeName) params.set('nodeId', selectedNodeName)
    const res = await fetchApi<{ logs: string }>(`/api/tasks/${selectedTaskId}/logs?${params}`)
    if (!res) return
    setLogs(res.logs ?? '')
    requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight })
  }, [selectedTaskId, selectedNodeName])

  useEffect(() => { loadLogs() }, [loadLogs])

  // Auto-refresh logs every 3s when task is running and tab is active
  useEffect(() => {
    if (!autoRefresh || !isRunning || activeTab !== 'logs') return
    const timer = setInterval(loadLogs, 3000)
    return () => clearInterval(timer)
  }, [autoRefresh, isRunning, activeTab, loadLogs])

  if (!selectedTaskId) return <div className="empty-state">Select a task to view logs</div>

  return (
    <div className="logs-tab-container">
      <div className="exec-log-toolbar">
        <span className="label">
          {selectedNodeName
            ? <>Node: {selectedNodeName} <button className="btn logs-show-all-btn" onClick={() => selectNode(null)}>Show All</button></>
            : 'Execution Log'
          }
          {isRunning && autoRefresh && <span className="logs-live-indicator"> (live)</span>}
        </span>
        <div className="logs-toolbar-actions">
          {isRunning && (
            <label className="logs-auto-label">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto
            </label>
          )}
          <button className="btn logs-refresh-btn" onClick={loadLogs}>Refresh</button>
        </div>
      </div>
      <div className="exec-log-viewer" ref={logRef}>{logs || '(no logs available)'}</div>
    </div>
  )
}
