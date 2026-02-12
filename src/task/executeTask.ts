/**
 * @entry Task 核心执行入口
 *
 * 编排任务执行流程，委托具体逻辑给子模块：
 * - prepareExecution: 准备新任务 / 恢复任务
 * - taskRecovery: 恢复模式的节点入队
 * - taskNotifications: 事件发射、日志、通知
 */

import { executeNode } from '../workflow/executeNode.js'
import { now } from '../shared/formatTime.js'
import {
  startWorkflow,
  createNodeWorker,
  startWorker,
  closeWorker,
  isWorkerRunning,
} from '../workflow/index.js'
import { updateInstanceStatus } from '../store/WorkflowStore.js'
import { updateTask } from '../store/TaskStore.js'
import { saveWorkflowOutput } from '../output/saveWorkflowOutput.js'
import { createLogger, setLogMode, logError as logErrorFn } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import { waitForWorkflowCompletion } from './ExecutionProgress.js'
import { setupIncrementalStatsSaving } from './ExecutionStats.js'
import { prepareNewExecution, prepareResume, ResumeConflictError } from './prepareExecution.js'
import { enqueueReadyNodesForResume } from './taskRecovery.js'
import { emitWorkflowStarted, emitWorkflowCompleted } from './taskNotifications.js'

export { ResumeConflictError } from './prepareExecution.js'

const logger = createLogger('execute-task')

const POLL_INTERVAL = 500
const DEFAULT_CONCURRENCY = 3

/**
 * 执行选项
 */
export interface ExecuteTaskOptions {
  concurrency?: number
  resume?: boolean
  useConsole?: boolean
}

/**
 * 执行结果
 */
export interface ExecuteTaskResult {
  success: boolean
  workflow: Workflow
  instance: WorkflowInstance
  outputPath: string
  timing: {
    startedAt: string
    completedAt: string
  }
}

/**
 * Task 核心执行函数
 *
 * 支持新任务执行和恢复执行两种模式。
 */
export async function executeTask(
  task: Task,
  options: ExecuteTaskOptions = {}
): Promise<ExecuteTaskResult> {
  const { concurrency = DEFAULT_CONCURRENCY, resume = false, useConsole = false } = options

  if (useConsole) {
    setLogMode('foreground')
  }

  logger.info(`${resume ? '恢复任务' : '开始执行任务'}: ${task.title}`)

  try {
    // Phase 1: Prepare workflow & instance
    let workflow: Workflow
    let instance: WorkflowInstance

    if (resume) {
      const result = await prepareResume(task)
      workflow = result.workflow
      instance = result.instance
    } else {
      const result = await prepareNewExecution(task)
      workflow = result.workflow
      instance = await startWorkflow(workflow.id)
      logger.info(`Workflow 启动: ${instance.id}`)

      // Direct answer — no node execution needed
      if (workflow.variables?.isDirectAnswer && workflow.variables?.directAnswer) {
        const answer = workflow.variables.directAnswer as string
        logger.info(`\n${answer}\n`)
        updateTask(task.id, { status: 'completed' })
        await updateInstanceStatus(instance.id, 'completed')
        return {
          success: true,
          workflow,
          instance,
          outputPath: '',
          timing: { startedAt: now(), completedAt: now() },
        }
      }

      emitWorkflowStarted(task, workflow, instance)
    }

    // Phase 2: Run workflow via NodeWorker
    updateTask(task.id, { status: 'developing', workflowId: workflow.id })
    logger.info(`任务状态: developing`)

    const startedAt = now()

    createNodeWorker({
      concurrency,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    const unsubscribeStats = setupIncrementalStatsSaving(task.id, instance.id)

    if (resume) {
      await enqueueReadyNodesForResume(task.id, workflow, instance)
    }

    // Phase 3: Wait for completion and finalize
    const finalInstance = await waitForWorkflowCompletion(workflow, instance.id, task.id)
    const completedAt = now()

    await closeWorker()
    unsubscribeStats()

    const outputPath = await saveWorkflowOutput({
      task,
      workflow,
      instance: finalInstance,
      timing: { startedAt, completedAt },
    })

    // Emit events, save stats, send notifications
    await emitWorkflowCompleted({ workflow, finalInstance, task, startedAt, completedAt })

    // Update task status
    const success = finalInstance.status === 'completed'
    updateTask(task.id, {
      status: success ? 'completed' : 'failed',
      output: {
        workflowId: workflow.id,
        instanceId: finalInstance.id,
        finalStatus: finalInstance.status,
        timing: { startedAt, completedAt },
      },
    })

    logger.info(`输出保存至: ${outputPath}`)

    if (success) {
      logger.info(`任务完成: ${task.title}`)
      return { success, workflow, instance: finalInstance, outputPath, timing: { startedAt, completedAt } }
    } else {
      logger.error(`任务失败: ${task.title}`)
      const errorMsg = finalInstance.error || 'Unknown error (check logs for details)'
      logger.error(`错误: ${errorMsg}`)
      throw new Error(errorMsg)
    }
  } catch (error) {
    logErrorFn(logger, '执行出错', error instanceof Error ? error : String(error), {
      taskId: task.id,
    })

    if (isWorkerRunning()) {
      await closeWorker()
    }

    if (error instanceof ResumeConflictError) {
      logger.warn(`恢复冲突，任务可能仍在执行: ${task.id}`)
      throw error
    }

    updateTask(task.id, { status: 'failed' })
    throw error
  }
}
