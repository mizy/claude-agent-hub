/**
 * Value preference learning from task lifecycle events.
 *
 * Listens to task:completed events and task complete/reject operations
 * to accumulate value preferences over time.
 */

import { taskEventBus, type TaskCompletionPayload } from '../shared/events/taskEvents.js'
import { reinforceValue, weakenValue, type Evidence } from './valueSystem.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:values')

let registered = false

/** Infer which value dimensions a task description relates to */
function inferDimensions(description: string): string[] {
  const desc = description.toLowerCase()
  const dims: string[] = []

  if (/fix|bug|修复|故障|稳定|crash|error|recover/.test(desc)) dims.push('stability')
  if (/refactor|重构|clean|quality|lint|type|规范/.test(desc)) dims.push('code_quality')
  if (/perf|性能|优化|速度|fast|slow|缓存|cache/.test(desc)) dims.push('performance')
  if (/feat|功能|新增|实现|添加|feature|add/.test(desc)) dims.push('new_features')
  if (/ui|ux|界面|体验|美化|polish|样式|style/.test(desc)) dims.push('ux_polish')
  if (/auto|自动|自主|自驱|evolve|autonomous/.test(desc)) dims.push('autonomy')

  return dims
}

function handleTaskCompleted(payload: TaskCompletionPayload): void {
  try {
    if (!payload.success) return

    const desc = payload.task.description || payload.task.title || ''
    const dims = inferDimensions(desc)
    if (dims.length === 0) return

    const now = new Date().toISOString()
    const evidence: Evidence = {
      type: 'approve',
      description: `任务成功完成: ${desc.slice(0, 100)}`,
      timestamp: now,
      impact: 0.5,
    }

    for (const dim of dims) {
      reinforceValue(dim, evidence)
    }
  } catch (error) {
    logger.warn(`Value learning from task:completed failed: ${getErrorMessage(error)}`)
  }
}

/** Register value learning listeners on task event bus */
export function registerValueListeners(): void {
  if (registered) return
  registered = true

  taskEventBus.on('task:completed', handleTaskCompleted)
  logger.debug('Value learning listeners registered')
}

/**
 * Record value signal from task complete (user manually approves).
 * Call this from completeTask().
 */
export function recordApproveSignal(taskDescription: string): void {
  try {
    const dims = inferDimensions(taskDescription)
    if (dims.length === 0) return

    const evidence: Evidence = {
      type: 'approve',
      description: `用户手动确认完成: ${taskDescription.slice(0, 100)}`,
      timestamp: new Date().toISOString(),
      impact: 1.0, // Manual approve = stronger signal
    }

    for (const dim of dims) {
      reinforceValue(dim, evidence)
    }
  } catch (error) {
    logger.warn(`Value recordApproveSignal failed: ${getErrorMessage(error)}`)
  }
}

/**
 * Record value signal from task reject (user rejects result).
 * Call this from rejectTask().
 */
export function recordRejectSignal(taskDescription: string): void {
  try {
    const dims = inferDimensions(taskDescription)
    if (dims.length === 0) return

    const evidence: Evidence = {
      type: 'reject',
      description: `用户拒绝任务结果: ${taskDescription.slice(0, 100)}`,
      timestamp: new Date().toISOString(),
      impact: 1.0,
    }

    for (const dim of dims) {
      weakenValue(dim, evidence)
    }
  } catch (error) {
    logger.warn(`Value recordRejectSignal failed: ${getErrorMessage(error)}`)
  }
}

/**
 * Record value signal from task creation (user request = interest signal).
 * Call this from createTask().
 */
export function recordRequestSignal(taskDescription: string): void {
  try {
    const dims = inferDimensions(taskDescription)
    if (dims.length === 0) return

    const evidence: Evidence = {
      type: 'request',
      description: `用户创建任务: ${taskDescription.slice(0, 100)}`,
      timestamp: new Date().toISOString(),
      impact: 0.3, // Request = weaker signal than approve/reject
    }

    for (const dim of dims) {
      reinforceValue(dim, evidence)
    }
  } catch (error) {
    logger.warn(`Value recordRequestSignal failed: ${getErrorMessage(error)}`)
  }
}
