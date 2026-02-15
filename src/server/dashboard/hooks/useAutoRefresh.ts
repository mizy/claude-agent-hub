import { useEffect } from 'react'
import { useStore } from '../store/useStore'

const REFRESH_INTERVAL = 3000

/**
 * Auto-refresh task list and selected task data every 3 seconds.
 * Called once in App — drives all polling.
 */
export function useAutoRefresh() {
  const refreshTasks = useStore(s => s.refreshTasks)
  const refreshTaskData = useStore(s => s.refreshTaskData)
  const refreshTraceData = useStore(s => s.refreshTraceData)
  const selectedTaskId = useStore(s => s.selectedTaskId)
  const activeTab = useStore(s => s.activeTab)

  // Initial load + periodic refresh
  useEffect(() => {
    refreshTasks()
    const id = setInterval(refreshTasks, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [refreshTasks])

  // Refresh selected task data when selected or periodically
  useEffect(() => {
    if (!selectedTaskId) return

    refreshTaskData()
    const id = setInterval(refreshTaskData, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [selectedTaskId, refreshTaskData])

  // Refresh trace data when trace tab is active
  useEffect(() => {
    if (!selectedTaskId || activeTab !== 'trace') return

    refreshTraceData()
    const id = setInterval(refreshTraceData, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [selectedTaskId, activeTab, refreshTraceData])
}
