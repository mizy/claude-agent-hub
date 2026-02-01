import type { ExecutionTiming } from './output.js'

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus = 'pending' | 'planning' | 'developing' | 'reviewing' | 'completed' | 'failed' | 'cancelled'

export interface Task {
  id: string
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  assignee?: string
  branch?: string
  workflowId?: string
  retryCount: number
  lastRejectReason?: string
  createdAt: string
  updatedAt?: string

  // Execution output (populated when task completes)
  output?: TaskOutput
}

export interface TaskOutput {
  workflowId: string
  instanceId: string
  finalStatus: string
  timing: ExecutionTiming
  error?: string
}

export interface CreateTaskOptions {
  title: string
  description?: string
  priority?: string
  assignee?: string
}
