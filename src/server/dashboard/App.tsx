import { useEffect } from 'react'
import { Sidebar, NewTaskModal, DeleteConfirmModal } from './components/Sidebar'
import { WorkflowCanvas } from './components/WorkflowCanvas'
import { RightPanel } from './components/RightPanel'
import { Toast } from './components/Toast'
import { useAutoRefresh } from './hooks/useAutoRefresh'
import { useStore } from './store/useStore'

export function App() {
  useAutoRefresh()

  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const rightPanelOpen = useStore((s) => s.rightPanelOpen)
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen)
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed)
  const toggleRightPanelCollapsed = useStore((s) => s.toggleRightPanelCollapsed)
  const closeMobilePanels = useStore((s) => s.closeMobilePanels)
  const setShowNewTaskModal = useStore((s) => s.setShowNewTaskModal)
  const setPendingDeleteTask = useStore((s) => s.setPendingDeleteTask)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNewTaskModal(false)
        setPendingDeleteTask(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setShowNewTaskModal, setPendingDeleteTask])

  // Close mobile panels on resize to desktop
  useEffect(() => {
    const handler = () => { if (window.innerWidth > 768) closeMobilePanels() }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [closeMobilePanels])

  const toggleSidebar = () => {
    if (sidebarOpen) {
      setSidebarOpen(false)
    } else {
      setSidebarOpen(true)
      setRightPanelOpen(false)
    }
  }

  const togglePanel = () => {
    if (window.innerWidth <= 768) {
      if (rightPanelOpen) {
        setRightPanelOpen(false)
      } else {
        setRightPanelOpen(true)
        setSidebarOpen(false)
      }
    } else {
      toggleRightPanelCollapsed()
    }
  }

  return (
    <>
      <button className="sidebar-toggle" onClick={toggleSidebar}>&#9776;</button>
      <button className="panel-toggle" onClick={togglePanel}>&#9703;</button>
      {(sidebarOpen || rightPanelOpen) && (
        <div className="sidebar-backdrop visible" onClick={closeMobilePanels} />
      )}

      <div className="container">
        <div className={`sidebar-wrap ${sidebarOpen ? 'open' : ''}`}>
          <Sidebar />
        </div>
        <WorkflowCanvas />
        <div className={`right-panel-wrap ${rightPanelOpen ? 'open' : ''} ${rightPanelCollapsed ? 'collapsed' : ''}`}>
          <RightPanel />
        </div>
      </div>

      <NewTaskModal />
      <DeleteConfirmModal />
      <Toast />
    </>
  )
}
