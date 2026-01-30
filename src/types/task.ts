import type { Plan } from './plan.js'

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus = 'pending' | 'planning' | 'developing' | 'reviewing' | 'completed' | 'failed'

export interface Task {
  id: string
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  assignee?: string
  branch?: string
  plan?: Plan
  retryCount: number
  lastRejectReason?: string
  createdAt: string
}

export interface CreateTaskOptions {
  title: string
  description?: string
  priority?: string
  assignee?: string
}
