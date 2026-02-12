export type TaskMessageSource = 'cli' | 'lark' | 'telegram'

export interface TaskMessage {
  id: string
  taskId: string
  content: string
  source: TaskMessageSource
  timestamp: string
  consumed: boolean
}
