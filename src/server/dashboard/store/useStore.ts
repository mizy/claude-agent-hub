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

// Trace types (matching API responses from TraceStore)
export interface SpanCost { amount: number; currency: string }
export interface TokenUsage { inputTokens: number; outputTokens: number; totalTokens: number }
export interface SpanError { message: string; stack?: string; category?: string }

export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'workflow' | 'node' | 'llm' | 'tool' | 'internal'
  startTime: number
  endTime?: number
  durationMs?: number
  status: 'running' | 'ok' | 'error'
  attributes: Record<string, unknown>
  tokenUsage?: TokenUsage
  cost?: SpanCost
  error?: SpanError
}

export interface TraceData {
  traceId: string
  taskId: string
  instanceId: string
  rootSpanId: string
  spans: TraceSpan[]
  status: 'running' | 'ok' | 'error'
  totalDurationMs: number
  totalTokens: number
  totalCost: number
  spanCount: number
  llmCallCount: number
}

export interface TaskMessage {
  id: string
  taskId: string
  content: string
  source: string
  createdAt: string
}

interface DashboardStore {
  tasks: Task[]
  selectedTaskId: string | null
  taskData: TaskData | null
  timelineLogs: TimelineEvent[]
  selectedNodeId: string | null
  activeTab: 'details' | 'timeline' | 'logs' | 'output' | 'trace'
  toasts: ToastItem[]
  showNewTaskModal: boolean
  showMessageModal: string | null  // taskId or null
  showInjectNodeModal: string | null  // taskId or null
  pendingDeleteTask: { id: string; title: string } | null
  sidebarOpen: boolean
  rightPanelOpen: boolean
  rightPanelCollapsed: boolean
  traceData: TraceData[] | null

  selectTask: (id: string) => void
  selectNode: (id: string | null) => void
  setActiveTab: (tab: DashboardStore['activeTab']) => void
  refreshTasks: () => Promise<void>
  refreshTaskData: () => Promise<void>
  refreshTraceData: () => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  createTask: (description: string) => Promise<boolean>
  stopTask: (id: string) => Promise<void>
  resumeTask: (id: string) => Promise<void>
  pauseTask: (id: string) => Promise<void>
  completeTask: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  sendMessage: (id: string, content: string) => Promise<void>
  injectNode: (id: string, prompt: string) => Promise<void>
  setShowNewTaskModal: (v: boolean) => void
  setShowMessageModal: (v: string | null) => void
  setShowInjectNodeModal: (v: string | null) => void
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
  showMessageModal: null,
  showInjectNodeModal: null,
  pendingDeleteTask: null,
  sidebarOpen: false,
  rightPanelOpen: false,
  rightPanelCollapsed: false,
  traceData: null,

  selectTask: id => {
    set({ selectedTaskId: id, selectedNodeId: null })
    get().refreshTaskData()
    if (window.innerWidth <= 768) get().closeMobilePanels()
  },

  selectNode: id => set({ selectedNodeId: id }),
  setActiveTab: tab => set({ activeTab: tab }),

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

  refreshTraceData: async () => {
    const { selectedTaskId } = get()
    if (!selectedTaskId) return
    const traces = await fetchApi<TraceData[]>(`/api/tasks/${selectedTaskId}/traces`)
    if (traces) set({ traceData: traces })
  },

  addToast: (message, type = 'info') => {
    const id = ++toastId
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, 3000)
  },

  createTask: async description => {
    const res = await postApi<{ success: boolean }>('/api/tasks', { description })
    if (res) {
      get().addToast('Task created and started', 'success')
      await get().refreshTasks()
      return true
    }
    get().addToast('Failed to create task', 'error')
    return false
  },

  stopTask: async id => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/stop`)
    if (res) {
      get().addToast('Task stopped', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to stop task', 'error')
  },

  resumeTask: async id => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/resume`)
    if (res) {
      get().addToast('Task resumed', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to resume task', 'error')
  },

  pauseTask: async id => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/pause`)
    if (res) {
      get().addToast('Task paused', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to pause task', 'error')
  },

  completeTask: async id => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/complete`)
    if (res) {
      get().addToast('Task completed', 'success')
      await get().refreshTasks()
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to complete task', 'error')
  },

  deleteTask: async id => {
    const res = await deleteApi<{ success: boolean }>(`/api/tasks/${id}`)
    if (res) {
      get().addToast('Task deleted', 'success')
      if (get().selectedTaskId === id) set({ selectedTaskId: null, taskData: null })
      await get().refreshTasks()
    } else get().addToast('Failed to delete task', 'error')
  },

  sendMessage: async (id, content) => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/message`, { content })
    if (res) {
      get().addToast('Message sent', 'success')
    } else get().addToast('Failed to send message', 'error')
  },

  injectNode: async (id, prompt) => {
    const res = await postApi<{ success: boolean }>(`/api/tasks/${id}/inject-node`, { prompt })
    if (res) {
      get().addToast('Node injected', 'success')
      if (get().selectedTaskId === id) await get().refreshTaskData()
    } else get().addToast('Failed to inject node', 'error')
  },

  setShowNewTaskModal: v => set({ showNewTaskModal: v }),
  setShowMessageModal: v => set({ showMessageModal: v }),
  setShowInjectNodeModal: v => set({ showInjectNodeModal: v }),
  setPendingDeleteTask: v => set({ pendingDeleteTask: v }),
  setSidebarOpen: v => set({ sidebarOpen: v }),
  setRightPanelOpen: v => set({ rightPanelOpen: v }),
  toggleRightPanelCollapsed: () => set(s => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  closeMobilePanels: () => set({ sidebarOpen: false, rightPanelOpen: false }),
}))
