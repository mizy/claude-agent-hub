import { useEffect } from 'react'
import { Sidebar, NewTaskModal, DeleteConfirmModal, MessageModal, InjectNodeModal } from './components/Sidebar'
import { WorkflowCanvas } from './components/WorkflowCanvas'
import { RightPanel } from './components/RightPanel'
import { SettingsPage } from './components/SettingsPage'
import { ChatPage } from './components/ChatPage'
import { Toast } from './components/Toast'
import { useAutoRefresh } from './hooks/useAutoRefresh'
import { useStore, type PageId } from './store/useStore'

const NAV_ITEMS: { id: PageId; icon: string; label: string }[] = [
  { id: 'tasks', icon: '\u2630', label: 'Tasks' },
  { id: 'chat', icon: '\u{1F4AC}', label: 'Chat' },
  { id: 'settings', icon: '\u2699', label: 'Settings' },
]

export function App() {
  useAutoRefresh()

  const currentPage = useStore((s) => s.currentPage)
  const setCurrentPage = useStore((s) => s.setCurrentPage)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const rightPanelOpen = useStore((s) => s.rightPanelOpen)
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen)
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed)
  const toggleRightPanelCollapsed = useStore((s) => s.toggleRightPanelCollapsed)
  const closeMobilePanels = useStore((s) => s.closeMobilePanels)
  const setShowNewTaskModal = useStore((s) => s.setShowNewTaskModal)
  const setPendingDeleteTask = useStore((s) => s.setPendingDeleteTask)
  const setShowMessageModal = useStore((s) => s.setShowMessageModal)
  const setShowInjectNodeModal = useStore((s) => s.setShowInjectNodeModal)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNewTaskModal(false)
        setPendingDeleteTask(null)
        setShowMessageModal(null)
        setShowInjectNodeModal(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setShowNewTaskModal, setPendingDeleteTask, setShowMessageModal, setShowInjectNodeModal])

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
      {currentPage === 'tasks' && (
        <>
          <button className="sidebar-toggle" onClick={toggleSidebar}>&#9776;</button>
          <button className="panel-toggle" onClick={togglePanel}>&#9703;</button>
        </>
      )}
      {(sidebarOpen || rightPanelOpen) && (
        <div className="sidebar-backdrop visible" onClick={closeMobilePanels} />
      )}

      <div className="app-layout">
        <nav className="nav-bar">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.id)}
              title={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {currentPage === 'tasks' && (
          <div className="container">
            <div className={`sidebar-wrap ${sidebarOpen ? 'open' : ''}`}>
              <Sidebar />
            </div>
            <WorkflowCanvas />
            <div className={`right-panel-wrap ${rightPanelOpen ? 'open' : ''} ${rightPanelCollapsed ? 'collapsed' : ''}`}>
              <RightPanel />
            </div>
          </div>
        )}

        {currentPage === 'settings' && <SettingsPage />}
        {currentPage === 'chat' && <ChatPage />}
      </div>

      <NewTaskModal />
      <DeleteConfirmModal />
      <MessageModal />
      <InjectNodeModal />
      <Toast />
    </>
  )
}
