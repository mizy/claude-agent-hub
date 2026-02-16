/**
 * Lark card element builders — types, low-level builders, action payload factories
 */

import type {
  CardActionPayload,
  TaskDetailPayload,
  TaskLogsPayload,
  TaskStopPayload,
  TaskRetryPayload,
  TaskPausePayload,
  TaskResumePayload,
  TaskMsgPayload,
  AutoWaitConfirmPayload,
  TaskViewResultPayload,
  ListPagePayload,
  ApprovePayload,
  RejectPayload,
} from '../handlers/types.js'

// ── Card types ──

export interface LarkCard {
  config?: { wide_screen_mode: boolean }
  header: {
    title: { tag: 'plain_text'; content: string }
    template?: string
  }
  elements: LarkCardElement[]
}

export type LarkCardElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | { tag: 'note'; elements: Array<{ tag: 'plain_text'; content: string }> }
  | { tag: 'action'; actions: LarkCardButton[] }

export interface LarkCardButton {
  tag: 'button'
  text: { tag: 'plain_text'; content: string }
  type?: 'primary' | 'danger' | 'default'
  value?: CardActionPayload | Record<string, string>
}

// ── Element builders ──

export function buildCard(title: string, template: string, elements: LarkCardElement[]): LarkCard {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    elements,
  }
}

export function mdElement(content: string): LarkCardElement {
  return { tag: 'markdown', content }
}

export function hrElement(): LarkCardElement {
  return { tag: 'hr' }
}

export function noteElement(text: string): LarkCardElement {
  return { tag: 'note', elements: [{ tag: 'plain_text', content: text }] }
}

export function actionElement(buttons: LarkCardButton[]): LarkCardElement {
  return { tag: 'action', actions: buttons }
}

export function button(
  label: string,
  type: 'primary' | 'danger' | 'default',
  value: CardActionPayload | Record<string, string>
): LarkCardButton {
  return { tag: 'button', text: { tag: 'plain_text', content: label }, type, value }
}

// ── Action payload builders ──

export function taskDetailAction(taskId: string): TaskDetailPayload {
  return { action: 'task_detail', taskId }
}

export function taskLogsAction(taskId: string): TaskLogsPayload {
  return { action: 'task_logs', taskId }
}

export function taskStopAction(taskId: string): TaskStopPayload {
  return { action: 'task_stop', taskId }
}

export function taskRetryAction(taskId: string): TaskRetryPayload {
  return { action: 'task_retry', taskId }
}

export function listPageAction(page: number, filter?: string): ListPagePayload {
  return { action: 'list_page', page: String(page), ...(filter ? { filter } : {}) }
}

export function approveAction(nodeId: string, workflowId?: string, instanceId?: string): ApprovePayload {
  return { action: 'approve', nodeId, workflowId, instanceId }
}

export function rejectAction(nodeId: string, workflowId?: string, instanceId?: string): RejectPayload {
  return { action: 'reject', nodeId, workflowId, instanceId }
}

export function taskPauseAction(taskId: string): TaskPausePayload {
  return { action: 'task_pause', taskId }
}

export function taskResumeAction(taskId: string): TaskResumePayload {
  return { action: 'task_resume', taskId }
}

export function taskMsgAction(taskId: string): TaskMsgPayload {
  return { action: 'task_msg', taskId }
}

export function autoWaitConfirmAction(taskId: string): AutoWaitConfirmPayload {
  return { action: 'auto_wait_confirm', taskId }
}

export function taskViewResultAction(taskId: string): TaskViewResultPayload {
  return { action: 'task_view_result', taskId }
}
