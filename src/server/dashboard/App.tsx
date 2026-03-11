/**
 * @entry CAH Dashboard — 任务管理与工作流可视化面板
 *
 * 路由策略（双层路由，独立互不干扰）
 * ─────────────────────────────────────
 * - 页面路由：hash pathname 部分，#/tasks | #/chat | #/statistics | #/settings
 * - 任务选中路由：hash query 部分，#/tasks?id={taskId}&tab=logs
 * - 刷新浏览器自动恢复完整状态（页面 + 选中任务 + 当前 tab）
 * - hash 写入使用 replaceState 避免产生多余历史记录
 *
 * 状态管理（Zustand store 单一数据源）
 * ─────────────────────────────────────
 * 核心状态：
 *   currentPage   — 当前页面（tasks/chat/statistics/settings）
 *   selectedTaskId — 选中的 task ID（同步到 hash）
 *   selectedNodeId — workflow 中选中的节点
 *   activeTab      — 右侧面板当前 tab（details/timeline/logs/output/trace）
 *   taskData       — 选中 task 的完整数据（task + workflow + instance）
 *
 * 面板联动逻辑
 * ─────────────────────────────────────
 * 1. 左侧 Sidebar 选中 task → selectTask() → 更新 hash → 清空旧数据 → refreshTaskData()
 *    → WorkflowCanvas 渲染节点图 + 实时状态
 * 2. WorkflowCanvas 点击节点 → selectNode(id) → 右侧 DetailsTab 显示节点详情
 *    关键约束：selectNode 不重置 activeTab，用户在 logs/output 浏览时不被打断
 * 3. 右侧 RightPanel tab 切换 → setActiveTab() → 独立于节点选择，互不影响
 *
 * 自动刷新（useAutoRefresh hook）
 * ─────────────────────────────────────
 * - 3s 轮询 task list（refreshTasks）+ task detail（refreshTaskData）
 * - trace 数据仅在 trace tab 激活时刷新，避免不必要的 API 请求
 *
 * 关键约束
 * ─────────────────────────────────────
 * - selectNode 不重置 activeTab — 防止用户浏览 logs 时被强制切到 details
 * - hash 路由使用 replaceState — 避免 hashchange 事件循环触发
 * - hashchange listener 在 App mount 时注册，处理浏览器前进/后退
 */
import { useEffect } from 'react'
import { Sidebar, NewTaskModal, DeleteConfirmModal, MessageModal, InjectNodeModal } from './components/Sidebar'
import { WorkflowCanvas } from './components/WorkflowCanvas'
import { RightPanel } from './components/RightPanel'
import { SettingsPage } from './components/SettingsPage'
import { ChatPage } from './components/ChatPage'
import { StatisticsPage } from './components/StatisticsPage'
import { Toast } from './components/Toast'
import { useAutoRefresh } from './hooks/useAutoRefresh'
import { useStore, type PageId } from './store/useStore'

const NAV_ITEMS: { id: PageId; icon: string; label: string }[] = [
  { id: 'tasks', icon: '\u2630', label: 'Tasks' },
  { id: 'chat', icon: '\u{1F4AC}', label: 'Chat' },
  { id: 'statistics', icon: '\u{1F4CA}', label: 'Stats' },
  { id: 'settings', icon: '\u2699', label: 'Settings' },
]

/** @entry Root component — layout, hash routing, keyboard shortcuts */
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

  const selectTask = useStore((s) => s.selectTask)
  const setActiveTab = useStore((s) => s.setActiveTab)

  // Sync state from hash on mount; restore task selection if id present
  useEffect(() => {
    const selectedTaskId = useStore.getState().selectedTaskId
    if (selectedTaskId) {
      // Trigger data fetch for task restored from hash
      useStore.getState().refreshTaskData()
    }
  }, [])

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#\/?/, '')
      const [path, query] = hash.split('?')
      const pageMap: Record<string, PageId> = { tasks: 'tasks', chat: 'chat', settings: 'settings', statistics: 'statistics' }
      const page = pageMap[path] ?? 'tasks'
      const params = new URLSearchParams(query ?? '')
      setCurrentPage(page)
      const id = params.get('id')
      const currentId = useStore.getState().selectedTaskId
      if (id && id !== currentId) selectTask(id)
      else if (!id && currentId) selectTask(null)
      const tab = params.get('tab')
      if (tab) setActiveTab(tab as 'details' | 'timeline' | 'logs' | 'output' | 'trace')
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [setCurrentPage, selectTask, setActiveTab])

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
        {currentPage === 'statistics' && <StatisticsPage />}
      </div>

      <NewTaskModal />
      <DeleteConfirmModal />
      <MessageModal />
      <InjectNodeModal />
      <Toast />
    </>
  )
}
