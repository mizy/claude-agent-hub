import { create } from 'zustand'
import { fetchApi, postApi, deleteApi } from '../api/fetchApi'

// Types matching API responses
export interface Task {
  id: string
  title: string
  description: string
  status: string
  priority: string
  createdAt: string
  retryCount: number
}

export interface WorkflowNode {
  id: string
  name: string
  type: string
  config?: { bodyNodes?: string[] }
}

export interface WorkflowEdge {
  from: string
  to: string
}

export interface NodeState {
  status: string
  attempts: number
  durationMs?: number
  error?: string
}

export interface Workflow {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface Instance {
  nodeStates: Record<string, NodeState>
  outputs: Record<string, unknown>
  variables: Record<string, unknown>
  loopCounts?: Record<string, number>
}

export interface TaskData {
  task: Task
  workflow: Workflow | null
  instance: Instance | null
}

export interface TimelineEvent {
  timestamp: string
  event: string
  nodeId?: string
  nodeName?: string
}

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface DashboardStore {
  tasks: Task[]
  selectedTaskId: string | null
  taskData: TaskData | null
  timelineLogs: TimelineEvent[]
  selectedNodeId: string | null
  activeTab: 'details' | 'timeline' | 'logs' | 'output'
  toasts: ToastItem[]
  showNewTaskModal: boolean
  pendingDeleteTask: { id: string; title: string } | null
  sidebarOpen: boolean
  rightPanelOpen: boolean
  rightPanelCollapsed: boolean

  selectTask: (id: string) => void
  selectNode: (id: string | null) => void
  setActiveTab: (tab: DashboardStore['activeTab']) => void
  refreshTasks: () => Promise<void>
  refreshTaskData: () => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  createTask: (description: string) => Promise<boolean>
  stopTask: (id: string) => Promise<void>
  resumeTask: (id: string) => Promise<void>
  completeTask: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  setShowNewTaskModal: (v: boolean) => void
  setPendingDeleteTask: (v: { id: string; title: string } | null) => void
  setSidebarOpen: (v: boolean) => void
  setRightPanelOpen: (v: boolean) => void
  toggleRightPanelCollapsed: () => void
  closeMobilePanels: () => void
}

let toastId = 0

export const useStore = create<DashboardStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  taskData: null,
  timelineLogs: [],
  selectedNodeId: null,
  activeTab: 'details',
  toasts: [],
  showNewTaskModal: false,
  pendingDeleteTask: null,
  sidebarOpen: false,
  rightPanelOpen: false,
  rightPanelCollapsed: false,

  selectTask: (id) => {
    set({ selectedTaskId: id, selectedNodeId: null })
    get().refreshTaskData()
    if (window.innerWidth <= 768) get().closeMobilePanels()
  },

  selectNode: (id) => set({ selectedNodeId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  refreshTasks: async () => {
    const tasks = await fetchApi<Task[]>('/api/tasks')
    if (tasks) set({ tasks })
  },

  refreshTaskData: async () => {
    const { selectedTaskId } = get()
    if (!selectedTaskId) return
    const [taskData, timeline] = await Promise.all([
      fetchApi<TaskData>(`/api/tasks/${selectedTaskId}`),
      fetchApi<TimelineEvent[]>(`/api/tasks/${selectedTaskId}/timeline`),
    ])
    if (taskData) set({ taskData })
    if (timeline) set({ timelineLogs: timeline })
  },

  addToast: (message, type = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3000)
  },

  createTask: async (description) => {
    const res = await postApi<{ success: boolean }>('/api/tasks', { description })
    if (res) {
      get().addToast('Task created and started', 'success')
      await get().refreshTasks()
      return true
    }
    get().addToast('Failed to create task', 'error')
    return false
  },

  stopTask: async (id) => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/stop`)
    if (res) {
      get().addToast('Task stopped', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to stop task', 'error')
  },

  resumeTask: async (id) => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/resume`)
    if (res) {
      get().addToast('Task resumed', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to resume task', 'error')
  },

  completeTask: async (id) => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/complete`)
    if (res) {
      get().addToast('Task completed', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to complete task', 'error')
  },

  deleteTask: async (id) => {
    const res = await deleteApi<{ success: boolean }>(`/api/tasks/${id}`)
    if (res) {
      get().addToast('Task deleted', 'success')
      if (get().selectedTaskId === id) set({ selectedTaskId: null, taskData: null })
      await get().refreshTasks()
    } else get().addToast('Failed to delete task', 'error')
  },

  setShowNewTaskModal: (v) => set({ showNewTaskModal: v }),
  setPendingDeleteTask: (v) => set({ pendingDeleteTask: v }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setRightPanelOpen: (v) => set({ rightPanelOpen: v }),
  toggleRightPanelCollapsed: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  closeMobilePanels: () => set({ sidebarOpen: false, rightPanelOpen: false }),
}))
