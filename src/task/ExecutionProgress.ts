/**
 * 执行进度显示
 * 进度条和 ETA 显示逻辑
 */

import { getWorkflowProgress } from '../workflow/index.js'
import { getInstance, updateInstanceStatus } from '../store/WorkflowStore.js'
import { getTask } from '../store/TaskStore.js'
import { estimateRemainingTime, formatTimeEstimate } from '../analysis/index.js'
import { createLogger } from '../shared/logger.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('progress')

// 轮询间隔（毫秒）
const POLL_INTERVAL = 500

/**
 * 创建进度条字符串
 */
export function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `[${bar}] ${percentage}%`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 等待 Workflow 完成
 * @param taskId - 可选的 taskId，用于检查 task 状态是否被外部修改
 */
export async function waitForWorkflowCompletion(
  workflow: Workflow,
  instanceId: string,
  taskId?: string
): Promise<WorkflowInstance> {
  let lastProgress = -1
  let lastRunningNodes: string[] = []
  const startTime = Date.now()
  let lastLogTime = 0
  const MIN_LOG_INTERVAL = 3000 // 至少间隔 3 秒才更新进度

  while (true) {
    await sleep(POLL_INTERVAL)

    const instance = getInstance(instanceId)
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`)
    }

    // 检查是否完成
    if (
      instance.status === 'completed' ||
      instance.status === 'failed' ||
      instance.status === 'cancelled'
    ) {
      return instance
    }

    // 检查 task 状态是否被外部修改（如手动停止、超时等）
    if (taskId) {
      const task = getTask(taskId)
      if (task && (task.status === 'failed' || task.status === 'cancelled')) {
        logger.info(`Task status changed to ${task.status}, syncing instance status...`)
        // 同步 instance 状态
        updateInstanceStatus(instanceId, task.status === 'cancelled' ? 'cancelled' : 'failed')
        // 重新获取更新后的 instance
        const updatedInstance = getInstance(instanceId)
        if (updatedInstance) {
          return updatedInstance
        }
        return instance
      }
    }

    // 获取当前运行中的节点
    const runningNodes = Object.entries(instance.nodeStates)
      .filter(([, state]) => state.status === 'running')
      .map(([nodeId]) => {
        const node = workflow.nodes.find(n => n.id === nodeId)
        return node?.name || nodeId
      })

    // 打印进度（进度变化或运行节点变化时，但限制频率）
    const progress = getWorkflowProgress(instance, workflow)
    const runningNodesChanged =
      runningNodes.length !== lastRunningNodes.length ||
      runningNodes.some((n, i) => n !== lastRunningNodes[i])
    const currentTime = Date.now()
    const shouldLog =
      (progress.percentage !== lastProgress || runningNodesChanged) &&
      currentTime - lastLogTime >= MIN_LOG_INTERVAL

    if (shouldLog) {
      // 计算时间预估
      const elapsedMs = currentTime - startTime
      const nodeStates = workflow.nodes
        .filter(n => n.type !== 'start' && n.type !== 'end')
        .map(n => {
          const state = instance.nodeStates[n.id]
          return {
            name: n.name,
            type: n.type,
            status: (state?.status || 'pending') as
              | 'pending'
              | 'running'
              | 'completed'
              | 'failed'
              | 'skipped',
            durationMs: state?.durationMs,
            startedAt: state?.startedAt,
          }
        })

      const estimate = estimateRemainingTime(nodeStates, elapsedMs)
      const progressBar = createProgressBar(progress.percentage)
      const runningInfo = runningNodes.length > 0 ? ` [${runningNodes.join(', ')}]` : ''
      const timeInfo = estimate.remainingMs > 0 ? ` ETA: ${formatTimeEstimate(estimate)}` : ''

      logger.info(`${progressBar} ${progress.completed}/${progress.total}${runningInfo}${timeInfo}`)
      lastProgress = progress.percentage
      lastRunningNodes = runningNodes
      lastLogTime = currentTime
    }
  }
}
