import type { Plan } from './plan.js'
import type { StepOutput, ExecutionTiming } from './output.js'

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
  plan?: Plan
  retryCount: number
  lastRejectReason?: string
  createdAt: string

  // Execution output (populated when task completes)
  output?: {
    stepOutputs: StepOutput[]
    timing: ExecutionTiming
  }
}

export interface CreateTaskOptions {
  title: string
  description?: string
  priority?: string
  assignee?: string
}
