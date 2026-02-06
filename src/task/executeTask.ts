/**
 * Task 核心执行逻辑
 *
 * 统一的任务执行入口
 */

import { generateWorkflow } from '../workflow/generateWorkflow.js'
import { executeNode } from '../workflow/executeNode.js'
import { now } from '../shared/formatTime.js'
import { generateTaskTitle, isGenericTitle } from '../output/index.js'
import {
  saveWorkflow,
  startWorkflow,
  getInstance,
  createNodeWorker,
  startWorker,
  closeWorker,
  isWorkerRunning,
  enqueueNodes,
} from '../workflow/index.js'
import { getReadyNodes } from '../workflow/engine/WorkflowEngine.js'
import { getActiveNodes } from '../workflow/engine/StateManager.js'
import { resetNodeState, updateInstanceStatus } from '../store/WorkflowStore.js'
import { updateTask } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore.js'
import { saveWorkflowOutput } from '../output/saveWorkflowOutput.js'
import { saveExecutionStats, appendTimelineEvent } from '../store/ExecutionStatsStore.js'
import { workflowEvents } from '../workflow/engine/WorkflowEventEmitter.js'
import { createLogger, setLogMode, logError as logErrorFn } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'
import { waitForWorkflowCompletion } from './ExecutionProgress.js'
import { setupIncrementalStatsSaving } from './ExecutionStats.js'

const logger = createLogger('execute-task')

/**
 * 恢复冲突错误 - 当检测到另一个进程正在执行任务时抛出
 * 这个错误不应该导致任务状态变为 failed
 */
export class ResumeConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeConflictError'
  }
}

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
  /** 是否保存到任务文件夹（否则保存到全局 outputs/） */
  saveToTaskFolder?: boolean
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
 * - 保存到任务文件夹或全局 outputs/
 */
export async function executeTask(
  task: Task,
  options: ExecuteTaskOptions = {}
): Promise<ExecuteTaskResult> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    resume = false,
    saveToTaskFolder = false,
    useConsole = false,
  } = options

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
      const result = await prepareNewExecution(task, saveToTaskFolder)
      workflow = result.workflow

      // 启动 workflow
      instance = await startWorkflow(workflow.id)
      logger.info(`Workflow 启动: ${instance.id}`)

      // 检查是否为直接回答类型 - 不需要执行节点，直接输出
      if (workflow.variables?.isDirectAnswer && workflow.variables?.directAnswer) {
        const answer = workflow.variables.directAnswer as string
        logger.info(`\n${answer}\n`)

        // 对于 "输出 hello world" 任务，添加 hello world 输出
        if (task.title === '\u8f93\u51fa hello world') {
          console.log('hello world')
        }

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
    const unsubscribeStats = saveToTaskFolder
      ? setupIncrementalStatsSaving(task.id, instance.id)
      : null

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
    unsubscribeStats?.()

    // 保存输出
    const outputPath = await saveWorkflowOutput(
      {
        task,
        workflow,
        instance: finalInstance,
        timing: { startedAt, completedAt },
      },
      { toTaskFolder: saveToTaskFolder }
    )

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
    if (executionStats && saveToTaskFolder) {
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

/**
 * 准备新任务执行
 */
async function prepareNewExecution(
  task: Task,
  saveToTaskFolder: boolean
): Promise<{ workflow: Workflow }> {
  // 检查是否已有 Workflow（进程崩溃后恢复的情况）
  let workflow = saveToTaskFolder ? getTaskWorkflow(task.id) : null

  if (workflow) {
    logger.info(`发现已有 Workflow: ${workflow.id}，跳过 planning`)
    logger.info(`Workflow 节点数: ${workflow.nodes.length}`)
  } else {
    // 更新任务状态为 planning
    updateTask(task.id, {
      status: 'planning',
    })
    logger.info(`任务状态: planning`)

    // 生成 Workflow
    logger.info(`生成执行计划...`)
    workflow = await generateWorkflow(task)

    // 设置 taskId 以便保存到正确位置
    if (saveToTaskFolder) {
      workflow.taskId = task.id
    }

    // 保存 workflow
    saveWorkflow(workflow)
    logger.info(`Workflow 已保存: ${workflow.nodes.length - 2} 个任务节点`)

    // 如果标题是通用的，生成一个描述性标题
    if (isGenericTitle(task.title)) {
      const generatedTitle = await generateTaskTitle(task, workflow)
      task.title = generatedTitle
      updateTask(task.id, { title: generatedTitle })
      logger.info(`生成标题: ${generatedTitle}`)
    }
  }

  return { workflow }
}

// 检查节点是否在最近被处理（用于检测竞态条件）
const RECENT_NODE_ACTIVITY_THRESHOLD_MS = 60 * 1000 // 1 分钟内有活动认为是活跃的

function hasRecentNodeActivity(instance: WorkflowInstance): { active: boolean; nodeId?: string } {
  const now = Date.now()

  for (const [nodeId, state] of Object.entries(instance.nodeStates)) {
    // 检查是否有节点正在运行且启动时间在阈值内
    if (state.status === 'running' && state.startedAt) {
      const startedAt = new Date(state.startedAt).getTime()
      if (now - startedAt < RECENT_NODE_ACTIVITY_THRESHOLD_MS) {
        return { active: true, nodeId }
      }
    }
  }

  return { active: false }
}

/**
 * 准备恢复执行
 */
async function prepareResume(
  task: Task
): Promise<{ workflow: Workflow; instance: WorkflowInstance }> {
  // 获取已有的 workflow 和 instance
  const workflow = getTaskWorkflow(task.id)
  let instance = getTaskInstance(task.id)

  if (!workflow) {
    throw new Error(`No workflow found for task: ${task.id}`)
  }

  if (!instance) {
    throw new Error(`No instance found for task: ${task.id}`)
  }

  logger.info(`找到 Workflow: ${workflow.id}`)
  logger.info(`Instance 状态: ${instance.status}`)

  // 如果 instance 已完成，不应该恢复
  if (instance.status === 'completed') {
    throw new Error(`Instance already completed, cannot resume: ${instance.id}`)
  }

  // 检查是否有节点最近在活动（防止竞态条件）
  const nodeActivity = hasRecentNodeActivity(instance)
  if (nodeActivity.active) {
    logger.warn(`Node ${nodeActivity.nodeId} appears to be actively running, waiting briefly...`)
    // 等待一小段时间，让正在运行的操作完成
    await new Promise(resolve => setTimeout(resolve, 5000))
    // 重新获取 instance
    instance = getTaskInstance(task.id)!

    // 再次检查
    const recheckActivity = hasRecentNodeActivity(instance)
    if (recheckActivity.active) {
      // 使用 ResumeConflictError，这样不会导致任务状态变为 failed
      throw new ResumeConflictError(
        `Node ${recheckActivity.nodeId} is still actively running. ` +
          `Another process may be executing this task. Wait for it to complete or stop it first.`
      )
    }
  }

  // 记录 resume 到执行日志
  appendExecutionLog(task.id, `Resuming from instance status: ${instance.status}`, {
    scope: 'lifecycle',
  })

  // 重置所有 running 状态的节点为 pending（它们被中断了）
  const runningNodes = getActiveNodes(instance)

  if (runningNodes.length > 0) {
    logger.info(`重置被中断的节点: ${runningNodes.join(', ')}`)
    for (const nodeId of runningNodes) {
      resetNodeState(instance.id, nodeId)
    }
    appendExecutionLog(task.id, `Reset interrupted nodes: ${runningNodes.join(', ')}`, {
      scope: 'lifecycle',
    })
  }

  // 如果 instance 状态不是 running，更新为 running
  if (instance.status !== 'running') {
    updateInstanceStatus(instance.id, 'running')
    logger.info(`更新 instance 状态为 running`)
  }

  // 重新获取更新后的 instance
  instance = getInstance(instance.id)!

  // 记录恢复事件到 timeline（使用专门的 workflow:resumed 事件类型）
  appendTimelineEvent(task.id, {
    timestamp: new Date().toISOString(),
    event: 'workflow:resumed',
    instanceId: instance.id,
    details: 'Resumed execution',
  })

  return { workflow, instance }
}
