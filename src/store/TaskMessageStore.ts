/**
 * @entry Task Message Store - 任务消息队列存储
 *
 * 支持在任务执行过程中接收来自 CLI/Lark/Telegram 的消息，
 * 并在 NodeWorker 执行节点时注入到 prompt context 中。
 *
 * 公共 API:
 * - addTaskMessage(): 添加消息到队列
 * - getUnconsumedMessages(): 获取未消费消息
 * - markMessagesConsumed(): 标记消息已消费
 * - getAllTaskMessages(): 获取所有消息
 */

import { generateId } from '../shared/generateId.js'
import type { TaskMessage, TaskMessageSource } from '../types/taskMessage.js'
import { getMessagesFilePath } from './paths.js'
import { readJson, writeJson, withFileLock } from './readWriteJson.js'

function getMessages(taskId: string): TaskMessage[] {
  return readJson<TaskMessage[]>(getMessagesFilePath(taskId), { defaultValue: [] }) ?? []
}

function saveMessages(taskId: string, messages: TaskMessage[]): void {
  writeJson(getMessagesFilePath(taskId), messages)
}

/** Add a message to a task's message queue (file-locked to prevent concurrent write loss) */
export function addTaskMessage(
  taskId: string,
  content: string,
  source: TaskMessageSource
): TaskMessage {
  const filePath = getMessagesFilePath(taskId)
  const lockPath = `${filePath}.lock`
  const msg: TaskMessage = {
    id: generateId(),
    taskId,
    content,
    source,
    timestamp: new Date().toISOString(),
    consumed: false,
  }
  withFileLock(lockPath, () => {
    const messages = getMessages(taskId)
    messages.push(msg)
    saveMessages(taskId, messages)
  })
  return msg
}

/** Get all unconsumed messages for a task */
export function getUnconsumedMessages(taskId: string): TaskMessage[] {
  return getMessages(taskId).filter(m => !m.consumed)
}

/** Mark messages as consumed (file-locked to prevent concurrent write loss) */
export function markMessagesConsumed(taskId: string, messageIds: string[]): void {
  const filePath = getMessagesFilePath(taskId)
  const lockPath = `${filePath}.lock`
  withFileLock(lockPath, () => {
    const messages = getMessages(taskId)
    const idSet = new Set(messageIds)
    for (const msg of messages) {
      if (idSet.has(msg.id)) {
        msg.consumed = true
      }
    }
    saveMessages(taskId, messages)
  })
}

/** Get all messages for a task */
export function getAllTaskMessages(taskId: string): TaskMessage[] {
  return getMessages(taskId)
}
