/**
 * Task 核心执行逻辑
 *
 * 统一的任务执行入口
 */

import { generateWorkflow } from './generateWorkflow.js'
import { executeNode } from './executeWorkflowNode.js'
import { now } from '../shared/time.js'
import { generateTaskTitle, isGenericTitle } from '../output/index.js'
import {
  saveWorkflow,
  startWorkflow,
  getInstance,
  getWorkflowProgress,
  createNodeWorker,
  startWorker,
  closeWorker,
  isWorkerRunning,
  enqueueNodes,
} from '../workflow/index.js'
import {
  getReadyNodes,
} from '../workflow/engine/WorkflowEngine.js'
import {
  resetNodeState,
  updateInstanceStatus,
} from '../store/WorkflowStore.js'
import { updateTask } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import { appendExecutionLog } from '../store/TaskLogStore.js'
import { saveWorkflowOutput } from '../output/saveWorkflowOutput.js'
import { saveExecutionStats, appendTimelineEvent } from '../store/ExecutionStatsStore.js'
import { workflowEvents } from '../workflow/engine/WorkflowEventEmitter.js'
import { createLogger } from '../shared/logger.js'
import { estimateRemainingTime, formatTimeEstimate } from './timeEstimator.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

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

  const log = useConsole ? console.log.bind(console) : logger.info.bind(logger)
  const logError = useConsole ? console.error.bind(console) : logger.error.bind(logger)

  log(`${resume ? '恢复任务' : '开始执行任务'}: ${task.title}`)

  try {
    let workflow: Workflow
    let instance: WorkflowInstance

    if (resume) {
      // 恢复模式：使用已有的 workflow 和 instance
      const result = await prepareResume(task, log)
      workflow = result.workflow
      instance = result.instance
    } else {
      // 新任务模式：检查是否已有 workflow 或生成新的
      const result = await prepareNewExecution(task, log, saveToTaskFolder)
      workflow = result.workflow

      // 启动 workflow
      instance = await startWorkflow(workflow.id)
      log(`Workflow 启动: ${instance.id}`)

      // 检查是否为直接回答类型 - 不需要执行节点，直接输出
      if (workflow.variables?.isDirectAnswer && workflow.variables?.directAnswer) {
        const answer = workflow.variables.directAnswer as string
        log(`\n${answer}\n`)

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

      // 记录时间线
      appendTimelineEvent(task.id, {
        timestamp: new Date().toISOString(),
        event: 'workflow:started',
      })
    }

    // 更新任务状态为 developing
    updateTask(task.id, {
      status: 'developing',
      workflowId: workflow.id,
    })
    log(`任务状态: developing`)

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
        log(`恢复执行节点: ${readyNodes.join(', ')}`)
        appendExecutionLog(task.id, `[RESUME] Enqueuing ready nodes: ${readyNodes.join(', ')}`)
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
        log(`警告：没有可执行的节点`)
        appendExecutionLog(task.id, `[RESUME] Warning: No ready nodes found`)
      }
    }

    // 等待 Workflow 完成
    const finalInstance = await waitForWorkflowCompletion(
      workflow,
      instance.id,
      log
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
        details: finalInstance.error,
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

    log(`输出保存至: ${outputPath}`)

    if (success) {
      log(`任务完成: ${task.title}`)
      return {
        success,
        workflow,
        instance: finalInstance,
        outputPath,
        timing: { startedAt, completedAt },
      }
    } else {
      logError(`任务失败: ${task.title}`)
      // 确保错误信息不会显示为 undefined
      const errorMsg = finalInstance.error || 'Unknown error (check logs for details)'
      logError(`错误: ${errorMsg}`)
      // 失败时抛出错误，让调用方知道
      throw new Error(errorMsg)
    }
  } catch (error) {
    // 捕获完整的错误信息，包括堆栈
    let errorMessage: string
    if (error instanceof Error) {
      errorMessage = error.stack || error.message || 'Unknown error'
    } else if (error === undefined || error === null) {
      errorMessage = 'Unknown error (undefined/null error object)'
    } else {
      errorMessage = String(error)
    }
    logError(`执行出错: ${errorMessage}`)

    // 确保关闭 worker
    if (isWorkerRunning()) {
      await closeWorker()
    }

    // 更新任务状态为 failed
    updateTask(task.id, { status: 'failed' })

    throw error
  }
}

/**
 * 准备新任务执行
 */
async function prepareNewExecution(
  task: Task,
  log: (...args: unknown[]) => void,
  saveToTaskFolder: boolean
): Promise<{ workflow: Workflow }> {
  // 检查是否已有 Workflow（进程崩溃后恢复的情况）
  let workflow = saveToTaskFolder ? getTaskWorkflow(task.id) : null

  if (workflow) {
    log(`发现已有 Workflow: ${workflow.id}，跳过 planning`)
    log(`Workflow 节点数: ${workflow.nodes.length}`)
  } else {
    // 更新任务状态为 planning
    updateTask(task.id, {
      status: 'planning',
    })
    log(`任务状态: planning`)

    // 生成 Workflow
    log(`生成执行计划...`)
    workflow = await generateWorkflow(task)

    // 设置 taskId 以便保存到正确位置
    if (saveToTaskFolder) {
      workflow.taskId = task.id
    }

    // 保存 workflow
    saveWorkflow(workflow)
    log(`Workflow 已保存: ${workflow.nodes.length - 2} 个任务节点`)

    // 如果标题是通用的，生成一个描述性标题
    if (isGenericTitle(task.title)) {
      const generatedTitle = await generateTaskTitle(task, workflow)
      task.title = generatedTitle
      updateTask(task.id, { title: generatedTitle })
      log(`生成标题: ${generatedTitle}`)
    }
  }

  return { workflow }
}

/**
 * 准备恢复执行
 */
async function prepareResume(
  task: Task,
  log: (...args: unknown[]) => void
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

  log(`找到 Workflow: ${workflow.id}`)
  log(`Instance 状态: ${instance.status}`)

  // 记录 resume 到执行日志
  appendExecutionLog(task.id, `[RESUME] Resuming from instance status: ${instance.status}`)

  // 重置所有 running 状态的节点为 pending（它们被中断了）
  const runningNodes = Object.entries(instance.nodeStates)
    .filter(([, state]) => state.status === 'running')
    .map(([nodeId]) => nodeId)

  if (runningNodes.length > 0) {
    log(`重置被中断的节点: ${runningNodes.join(', ')}`)
    for (const nodeId of runningNodes) {
      resetNodeState(instance.id, nodeId)
    }
    appendExecutionLog(task.id, `[RESUME] Reset interrupted nodes: ${runningNodes.join(', ')}`)
  }

  // 如果 instance 状态不是 running，更新为 running
  if (instance.status !== 'running') {
    updateInstanceStatus(instance.id, 'running')
    log(`更新 instance 状态为 running`)
  }

  // 重新获取更新后的 instance
  instance = getInstance(instance.id)!

  return { workflow, instance }
}

/**
 * 等待 Workflow 完成
 */
async function waitForWorkflowCompletion(
  workflow: Workflow,
  instanceId: string,
  log: (...args: unknown[]) => void
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
    const shouldLog = (progress.percentage !== lastProgress || runningNodesChanged) &&
                      (currentTime - lastLogTime >= MIN_LOG_INTERVAL)

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
            status: (state?.status || 'pending') as 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
            durationMs: state?.durationMs,
            startedAt: state?.startedAt,
          }
        })

      const estimate = estimateRemainingTime(nodeStates, elapsedMs)
      const progressBar = createProgressBar(progress.percentage)
      const runningInfo = runningNodes.length > 0
        ? ` [${runningNodes.join(', ')}]`
        : ''
      const timeInfo = estimate.remainingMs > 0 ? ` ETA: ${formatTimeEstimate(estimate)}` : ''

      log(`${progressBar} ${progress.completed}/${progress.total}${runningInfo}${timeInfo}`)
      lastProgress = progress.percentage
      lastRunningNodes = runningNodes
      lastLogTime = currentTime
    }
  }
}

/**
 * 创建进度条字符串
 */
function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `[${bar}] ${percentage}%`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 设置增量统计保存
 * 在节点状态变化时保存统计，用于实时监控和任务失败时的诊断
 */
function setupIncrementalStatsSaving(taskId: string, instanceId: string): () => void {
  let lastSaveTime = 0
  const SAVE_DEBOUNCE_MS = 1000 // 防止频繁写入，至少间隔 1 秒

  const saveHandler = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSaveTime < SAVE_DEBOUNCE_MS) {
      return
    }
    lastSaveTime = now

    const stats = workflowEvents.getExecutionStats(instanceId)
    if (stats) {
      // 计算当前执行时间
      const startTime = stats.startedAt ? new Date(stats.startedAt).getTime() : now
      stats.totalDurationMs = now - startTime

      saveExecutionStats(taskId, stats)
      logger.debug(`Saved incremental stats for task ${taskId}`)
    }
  }

  // 订阅所有节点事件：started, completed, failed
  const unsubscribe = workflowEvents.onNodeEvent((event) => {
    // 节点开始时立即保存（记录 running 状态）
    // 节点完成/失败时也保存
    if (event.type === 'node:started') {
      saveHandler(true) // 强制保存，确保 running 状态被记录
    } else if (event.type === 'node:completed' || event.type === 'node:failed') {
      saveHandler(true) // 强制保存，确保状态立即更新
    }
  })

  return unsubscribe
}

// 向后兼容的别名
/** @deprecated 使用 executeTask 代替 */
export const executeAgent = executeTask
/** @deprecated 使用 ExecuteTaskOptions 代替 */
export type ExecuteAgentOptions = ExecuteTaskOptions
/** @deprecated 使用 ExecuteTaskResult 代替 */
export type ExecuteAgentResult = ExecuteTaskResult
