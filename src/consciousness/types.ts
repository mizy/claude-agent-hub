/**
 * Consciousness entry types
 *
 * 跨会话持续意识流的数据结构定义
 */

export interface ConsciousnessEntry {
  /** ISO 8601 timestamp */
  ts: string
  /** Entry type */
  type: 'conversation_summary' | 'task_event' | 'daemon_event' | 'observation' | 'session_end'
  /** Content (max ~200 chars) */
  content: string
  /** Optional metadata */
  metadata?: {
    taskId?: string
    taskTitle?: string
    channel?: string
    duration?: number
    messageCount?: number
    /** Emotional shift during the session, e.g. "neutral→engaged" */
    emotionalShift?: string
    /** Unfinished thoughts or pending ideas from the session */
    unfinishedThoughts?: string[]
    /** What triggered the session end: timeout, clear, shutdown */
    triggerEvent?: string
  }
}
