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
import { updateInstanceStatus, updateInstanceVariables } from '../store/WorkflowStore.js'
import { updateTask, getTask } from '../store/TaskStore.js'
import { createRootSpan, endSpan } from '../store/createSpan.js'
import { appendSpan } from '../store/TraceStore.js'
import { appendExecutionLog } from '../store/TaskLogStore.js'
import { saveWorkflowOutput } from '../output/saveWorkflowOutput.js'
import { createLogger, setLogMode, logError as logErrorFn } from '../shared/logger.js'
import { isError, getErrorMessage, getErrorStack, getErrorCause } from '../shared/assertError.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import { waitForWorkflowCompletion } from './ExecutionProgress.js'
import { setupIncrementalStatsSaving } from './ExecutionStats.js'
import { prepareNewExecution, prepareResume, ResumeConflictError } from './prepareExecution.js'
import { enqueueReadyNodesForResume } from './taskRecovery.js'
import { emitWorkflowStarted, emitWorkflowCompleted } from './taskNotifications.js'
import { loggedErrors } from './loggedErrors.js'
import { redirectConsoleToTaskLog } from './redirectConsole.js'

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

  // Redirect console output to task's execution.log
  // This ensures task logs are captured even when running inside daemon process
  const restoreConsole = redirectConsoleToTaskLog(task.id)

  logger.info(`${resume ? '恢复任务' : '开始执行任务'}: ${task.title}`)

  // Track resources for cleanup in finally
  let unsubscribeStats: (() => void) | null = null
  let workflowSpan: ReturnType<typeof createRootSpan> | null = null
  let spanTaskId: string | null = null

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

    // Create root workflow span for tracing
    workflowSpan = createRootSpan(task.id, `workflow:${workflow.name}`, 'workflow', {
      'task.id': task.id,
      'workflow.id': workflow.id,
      'instance.id': instance.id,
      'workflow.name': workflow.name,
      'workflow.total_nodes': workflow.nodes.length,
    })
    spanTaskId = task.id
    appendSpan(task.id, workflowSpan)

    // Store span data in instance variables so executeNode can reconstruct TraceContext
    await updateInstanceVariables(instance.id, {
      _traceWorkflowSpan: {
        traceId: workflowSpan.traceId,
        spanId: workflowSpan.spanId,
        name: workflowSpan.name,
        kind: workflowSpan.kind,
        startTime: workflowSpan.startTime,
        status: workflowSpan.status,
        attributes: workflowSpan.attributes,
      },
    })

    createNodeWorker({
      concurrency,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    unsubscribeStats = setupIncrementalStatsSaving(task.id, instance.id)

    if (resume) {
      await enqueueReadyNodesForResume(task.id, workflow, instance)
    }

    // Phase 3: Wait for completion and finalize
    const finalInstance = await waitForWorkflowCompletion(workflow, instance.id, task.id)
    const completedAt = now()

    // Schedule-wait: task entered waiting state, process should exit cleanly.
    // Daemon's waitingRecoveryJob will resume when the scheduled time arrives.
    const currentTask = getTask(task.id)
    if (currentTask?.status === 'waiting') {
      logger.info('Task in waiting state (schedule-wait), process exiting without finalization')
      if (workflowSpan) {
        appendSpan(task.id, endSpan(workflowSpan))
        workflowSpan = null
      }
      return { success: true, workflow, instance: finalInstance, outputPath: '', timing: { startedAt, completedAt } }
    }

    // End workflow span (before finally, so we can set correct status)
    const success = finalInstance.status === 'completed'
    const endedWorkflowSpan = endSpan(
      workflowSpan,
      success ? undefined : { error: { message: finalInstance.error || 'Workflow failed' } }
    )
    appendSpan(task.id, endedWorkflowSpan)
    workflowSpan = null // Mark as handled, so finally won't double-close

    const outputPath = await saveWorkflowOutput({
      task,
      workflow,
      instance: finalInstance,
      timing: { startedAt, completedAt },
    })

    // Emit events, save stats, send notifications
    await emitWorkflowCompleted({ workflow, finalInstance, task, startedAt, completedAt })

    // Update task status
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
    logErrorFn(logger, '执行出错', isError(error) ? error : String(error), {
      taskId: task.id,
    })

    if (error instanceof ResumeConflictError) {
      logger.warn(`恢复冲突，任务可能仍在执行: ${task.id}`)
      throw error
    }

    // Save error details to execution.log and task.json
    // Skip logging if already logged by prepareExecution (avoid duplicate log entries)
    const alreadyLogged = isError(error) && loggedErrors.has(error)
    const errorMsg = getErrorMessage(error)
    if (!alreadyLogged) {
      const errorStack = getErrorStack(error)
      appendExecutionLog(task.id, `[ERROR] ${errorMsg}`, { level: 'error', scope: 'lifecycle' })
      const cause = getErrorCause(error)
      if (cause) {
        const causeMsg = getErrorMessage(cause)
        appendExecutionLog(task.id, `[ERROR] Caused by: ${causeMsg}`, { level: 'error', scope: 'lifecycle' })
      }
      if (errorStack) {
        appendExecutionLog(task.id, `[ERROR] Stack trace:\n${errorStack}`, { level: 'error', scope: 'lifecycle' })
      }
    }
    updateTask(task.id, { status: 'failed', error: errorMsg })
    throw error
  } finally {
    // Always clean up resources regardless of success or failure
    if (isWorkerRunning()) {
      try {
        await closeWorker()
      } catch (e) {
        logErrorFn(logger, 'Worker 关闭失败', isError(e) ? e : String(e), {
          taskId: task.id,
        })
      }
    }

    if (unsubscribeStats) {
      try {
        unsubscribeStats()
      } catch {
        // Stats cleanup is best-effort
      }
    }

    // End span if not already ended (error path)
    if (workflowSpan && spanTaskId) {
      try {
        const errorSpan = endSpan(workflowSpan, {
          error: { message: 'Workflow terminated unexpectedly' },
        })
        appendSpan(spanTaskId, errorSpan)
      } catch {
        // Span cleanup is best-effort
      }
    }

    // Restore original console methods
    restoreConsole()
  }
}
