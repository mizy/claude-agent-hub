/**
 * @entry Task Message Store - 任务消息队列存储
 *
 * 支持在任务执行过程中接收来自 CLI/Lark/Telegram 的消息，
 * 并在 NodeWorker 执行节点时注入到 prompt context 中。
 */

import { generateId } from '../shared/generateId.js'
import type { TaskMessage, TaskMessageSource } from '../types/taskMessage.js'
import { getMessagesFilePath } from './paths.js'
import { readJson, writeJson } from './readWriteJson.js'

function getMessages(taskId: string): TaskMessage[] {
  return readJson<TaskMessage[]>(getMessagesFilePath(taskId), { defaultValue: [] }) ?? []
}

function saveMessages(taskId: string, messages: TaskMessage[]): void {
  writeJson(getMessagesFilePath(taskId), messages)
}

/** Add a message to a task's message queue */
export function addTaskMessage(
  taskId: string,
  content: string,
  source: TaskMessageSource
): TaskMessage {
  const messages = getMessages(taskId)
  const msg: TaskMessage = {
    id: generateId(),
    taskId,
    content,
    source,
    timestamp: new Date().toISOString(),
    consumed: false,
  }
  messages.push(msg)
  saveMessages(taskId, messages)
  return msg
}

/** Get all unconsumed messages for a task */
export function getUnconsumedMessages(taskId: string): TaskMessage[] {
  return getMessages(taskId).filter(m => !m.consumed)
}

/** Mark messages as consumed */
export function markMessagesConsumed(taskId: string, messageIds: string[]): void {
  const messages = getMessages(taskId)
  const idSet = new Set(messageIds)
  for (const msg of messages) {
    if (idSet.has(msg.id)) {
      msg.consumed = true
    }
  }
  saveMessages(taskId, messages)
}

/** Get all messages for a task */
export function getAllTaskMessages(taskId: string): TaskMessage[] {
  return getMessages(taskId)
}
