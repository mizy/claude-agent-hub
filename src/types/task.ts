import type { ExecutionTiming } from './output.js'

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'developing'
  | 'paused'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled'

const VALID_PRIORITIES: readonly string[] = ['low', 'medium', 'high']
const VALID_STATUSES: readonly string[] = [
  'pending',
  'planning',
  'developing',
  'paused',
  'reviewing',
  'completed',
  'failed',
  'cancelled',
]

/** Parse and validate a TaskPriority string, returns 'medium' as fallback */
export function parseTaskPriority(value: string | undefined): TaskPriority {
  if (value && VALID_PRIORITIES.includes(value)) return value as TaskPriority
  return 'medium'
}

/** Parse and validate a TaskStatus string, returns null if invalid */
export function parseTaskStatus(value: string | undefined): TaskStatus | null {
  if (value && VALID_STATUSES.includes(value)) return value as TaskStatus
  return null
}

export interface Task {
  id: string
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  assignee?: string
  branch?: string
  workflowId?: string
  /** Working directory where the task was created (for conflict detection) */
  cwd?: string
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
