/**
 * Task 核心执行逻辑
 *
 * 统一的任务执行入口
 */

import { executeNode } from '../workflow/executeNode.js'
import { now } from '../shared/formatTime.js'
import {
  startWorkflow,
  createNodeWorker,
  startWorker,
  closeWorker,
  isWorkerRunning,
  enqueueNodes,
} from '../workflow/index.js'
import { getReadyNodes } from '../workflow/engine/WorkflowEngine.js'
import { updateInstanceStatus } from '../store/WorkflowStore.js'
import { updateTask } from '../store/TaskStore.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { saveWorkflowOutput } from '../output/saveWorkflowOutput.js'
import { saveExecutionStats, appendTimelineEvent } from '../store/ExecutionStatsStore.js'
import { workflowEvents } from '../workflow/engine/WorkflowEventEmitter.js'
import { createLogger, setLogMode, logError as logErrorFn } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import { waitForWorkflowCompletion } from './ExecutionProgress.js'
import { setupIncrementalStatsSaving } from './ExecutionStats.js'
import { prepareNewExecution, prepareResume, ResumeConflictError } from './prepareExecution.js'
import { sendTaskCompletionNotify } from './sendTaskNotify.js'

export { ResumeConflictError } from './prepareExecution.js'

const logger = createLogger('execute-task')

// 轮询间隔（毫秒）
const POLL_INTERVAL = 500

// 默认并发数（workflow 内的节点可并行）
const DEFAULT_CONCURRENCY = 3

/**
 * 执行选项
 */
export interface ExecuteTaskOptions {
  /** 节点并发数 */
  concurrency?: number
  /** 是否为恢复模式 */
  resume?: boolean
  /** 使用 console.log 而非 logger（用于前台模式） */
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
 * 统一的执行逻辑，支持：
 * - 新任务执行（生成 workflow）
 * - 恢复执行（使用已有 workflow）
 */
export async function executeTask(
  task: Task,
  options: ExecuteTaskOptions = {}
): Promise<ExecuteTaskResult> {
  const { concurrency = DEFAULT_CONCURRENCY, resume = false, useConsole = false } = options

  // 设置日志模式：前台运行用简洁输出，后台用完整结构化
  if (useConsole) {
    setLogMode('foreground')
  }

  logger.info(`${resume ? '恢复任务' : '开始执行任务'}: ${task.title}`)

  try {
    let workflow: Workflow
    let instance: WorkflowInstance

    if (resume) {
      // 恢复模式：使用已有的 workflow 和 instance
      const result = await prepareResume(task)
      workflow = result.workflow
      instance = result.instance
    } else {
      // 新任务模式：检查是否已有 workflow 或生成新的
      const result = await prepareNewExecution(task)
      workflow = result.workflow

      // 启动 workflow
      instance = await startWorkflow(workflow.id)
      logger.info(`Workflow 启动: ${instance.id}`)

      // Direct answer type — no node execution needed
      if (workflow.variables?.isDirectAnswer && workflow.variables?.directAnswer) {
        const answer = workflow.variables.directAnswer as string
        logger.info(`\n${answer}\n`)

        // 直接完成任务
        updateTask(task.id, { status: 'completed' })
        await updateInstanceStatus(instance.id, 'completed')

        return {
          success: true,
          workflow,
          instance,
          outputPath: '',
          timing: {
            startedAt: now(),
            completedAt: now(),
          },
        }
      }

      // 发射工作流开始事件
      const taskNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
      workflowEvents.emitWorkflowStarted({
        workflowId: workflow.id,
        instanceId: instance.id,
        workflowName: workflow.name,
        totalNodes: taskNodes.length,
      })

      // 写入结构化事件日志
      appendJsonlLog(task.id, {
        event: 'task_started',
        message: `Task started: ${task.title}`,
        data: {
          workflowId: workflow.id,
          instanceId: instance.id,
          totalNodes: taskNodes.length,
        },
      })

      // 记录时间线（包含 instanceId 以区分不同执行）
      appendTimelineEvent(task.id, {
        timestamp: new Date().toISOString(),
        event: 'workflow:started',
        instanceId: instance.id,
      })
    }

    // 更新任务状态为 developing
    updateTask(task.id, {
      status: 'developing',
      workflowId: workflow.id,
    })
    logger.info(`任务状态: developing`)

    const startedAt = now()

    // 创建并启动 NodeWorker
    createNodeWorker({
      concurrency,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    // 订阅节点事件，保存中间状态统计（用于任务失败时的诊断）
    const unsubscribeStats = setupIncrementalStatsSaving(task.id, instance.id)

    // 如果是恢复模式，需要手动入队可执行节点
    if (resume) {
      const readyNodes = getReadyNodes(workflow, instance)
      if (readyNodes.length > 0) {
        logger.info(`恢复执行节点: ${readyNodes.join(', ')}`)
        appendExecutionLog(task.id, `Enqueuing ready nodes: ${readyNodes.join(', ')}`, {
          scope: 'lifecycle',
        })
        await enqueueNodes(
          readyNodes.map(nodeId => ({
            data: {
              workflowId: workflow.id,
              instanceId: instance.id,
              nodeId,
              attempt: 1,
            },
          }))
        )
      } else {
        logger.warn(`没有可执行的节点`)
        appendExecutionLog(task.id, `Warning: No ready nodes found`, {
          scope: 'lifecycle',
          level: 'warn',
        })
      }
    }

    // 等待 Workflow 完成
    const finalInstance = await waitForWorkflowCompletion(
      workflow,
      instance.id,
      task.id // 传入 taskId 以便检查 task 状态是否被外部修改
    )

    const completedAt = now()

    // 关闭 worker
    await closeWorker()

    // 取消订阅中间状态保存
    unsubscribeStats()

    // 保存输出到 task 目录
    const outputPath = await saveWorkflowOutput({
      task,
      workflow,
      instance: finalInstance,
      timing: { startedAt, completedAt },
    })

    // 计算执行时间
    const totalDurationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()

    // 获取执行统计并发射完成事件
    const executionStats = workflowEvents.getExecutionStats(finalInstance.id)
    const totalCostUsd = executionStats?.summary.totalCostUsd ?? 0
    const nodesCompleted = executionStats?.summary.completedNodes ?? 0
    const nodesFailed = executionStats?.summary.failedNodes ?? 0

    if (finalInstance.status === 'completed') {
      workflowEvents.emitWorkflowCompleted({
        workflowId: workflow.id,
        instanceId: finalInstance.id,
        workflowName: workflow.name,
        totalDurationMs,
        nodesCompleted,
        nodesFailed,
        totalCostUsd,
      })
      appendTimelineEvent(task.id, {
        timestamp: completedAt,
        event: 'workflow:completed',
        instanceId: finalInstance.id,
      })

      // 写入结构化事件日志
      appendJsonlLog(task.id, {
        event: 'task_completed',
        message: `Task completed: ${task.title}`,
        durationMs: totalDurationMs,
        data: {
          workflowId: workflow.id,
          instanceId: finalInstance.id,
          nodesCompleted,
          nodesFailed,
          totalCostUsd,
        },
      })
    } else {
      workflowEvents.emitWorkflowFailed({
        workflowId: workflow.id,
        instanceId: finalInstance.id,
        workflowName: workflow.name,
        error: finalInstance.error || 'Unknown error',
        totalDurationMs,
        nodesCompleted,
      })
      appendTimelineEvent(task.id, {
        timestamp: completedAt,
        event: 'workflow:failed',
        instanceId: finalInstance.id,
        details: finalInstance.error,
      })

      // 写入结构化事件日志
      appendJsonlLog(task.id, {
        event: 'task_failed',
        message: `Task failed: ${task.title}`,
        durationMs: totalDurationMs,
        error: finalInstance.error || 'Unknown error',
        data: {
          workflowId: workflow.id,
          instanceId: finalInstance.id,
          nodesCompleted,
        },
      })
    }

    // 保存执行统计到任务文件夹
    if (executionStats) {
      executionStats.status = finalInstance.status
      executionStats.completedAt = completedAt
      executionStats.totalDurationMs = totalDurationMs
      saveExecutionStats(task.id, executionStats)
    }

    // 更新任务状态
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

    // 发送 Telegram 任务完成通知（失败不影响任务状态）
    await sendTaskCompletionNotify(task, success, {
      durationMs: totalDurationMs,
      error: finalInstance.error,
    })

    logger.info(`输出保存至: ${outputPath}`)

    if (success) {
      logger.info(`任务完成: ${task.title}`)
      return {
        success,
        workflow,
        instance: finalInstance,
        outputPath,
        timing: { startedAt, completedAt },
      }
    } else {
      logger.error(`任务失败: ${task.title}`)
      // 确保错误信息不会显示为 undefined
      const errorMsg = finalInstance.error || 'Unknown error (check logs for details)'
      logger.error(`错误: ${errorMsg}`)
      // 失败时抛出错误，让调用方知道
      throw new Error(errorMsg)
    }
  } catch (error) {
    // 使用 logError 记录带上下文的错误
    logErrorFn(logger, '执行出错', error instanceof Error ? error : String(error), {
      taskId: task.id,
    })

    // 确保关闭 worker
    if (isWorkerRunning()) {
      await closeWorker()
    }

    // ResumeConflictError 不应该导致任务状态变为 failed
    // 因为原来的执行可能还在继续
    if (error instanceof ResumeConflictError) {
      logger.warn(`恢复冲突，任务可能仍在执行: ${task.id}`)
      throw error
    }

    // 其他错误：更新任务状态为 failed
    updateTask(task.id, { status: 'failed' })

    throw error
  }
}
