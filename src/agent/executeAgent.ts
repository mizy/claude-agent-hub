/**
 * Agent 核心执行逻辑
 *
 * 提取 runAgent, runAgentForTask, resumeAgentForTask 的公共逻辑
 */

import { getStore } from '../store/index.js'
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
import { createLogger } from '../shared/logger.js'
import type { Agent, AgentContext } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('execute-agent')

// 轮询间隔（毫秒）
const POLL_INTERVAL = 500

// 默认并发数
const DEFAULT_CONCURRENCY = 3

/**
 * 执行选项
 */
export interface ExecuteAgentOptions {
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
export interface ExecuteAgentResult {
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
 * Agent 核心执行函数
 *
 * 统一的执行逻辑，支持：
 * - 新任务执行（生成 workflow）
 * - 恢复执行（使用已有 workflow）
 * - 保存到任务文件夹或全局 outputs/
 */
export async function executeAgent(
  agent: Agent,
  task: Task,
  options: ExecuteAgentOptions = {}
): Promise<ExecuteAgentResult> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    resume = false,
    saveToTaskFolder = false,
    useConsole = false,
  } = options

  const store = getStore()
  const log = useConsole ? console.log.bind(console) : logger.info.bind(logger)
  const logError = useConsole ? console.error.bind(console) : logger.error.bind(logger)

  log(`[${agent.name}] ${resume ? '恢复任务' : '开始执行任务'}: ${task.title}`)

  // 更新 Agent 状态
  store.updateAgent(agent.name, { status: 'working' })

  try {
    let workflow: Workflow
    let instance: WorkflowInstance

    if (resume) {
      // 恢复模式：使用已有的 workflow 和 instance
      const result = await prepareResume(task, agent.name, log)
      workflow = result.workflow
      instance = result.instance
    } else {
      // 新任务模式：检查是否已有 workflow 或生成新的
      const result = await prepareNewExecution(task, agent, log, saveToTaskFolder)
      workflow = result.workflow

      // 启动 workflow
      instance = await startWorkflow(workflow.id)
      log(`[${agent.name}] Workflow 启动: ${instance.id}`)
    }

    // 更新任务状态为 developing
    updateTask(task.id, {
      status: 'developing',
      workflowId: workflow.id,
    })
    log(`[${agent.name}] 任务状态: developing`)

    const startedAt = now()

    // 创建并启动 NodeWorker
    createNodeWorker({
      concurrency,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    // 如果是恢复模式，需要手动入队可执行节点
    if (resume) {
      const readyNodes = getReadyNodes(workflow, instance)
      if (readyNodes.length > 0) {
        log(`[${agent.name}] 恢复执行节点: ${readyNodes.join(', ')}`)
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
        log(`[${agent.name}] 警告：没有可执行的节点`)
        appendExecutionLog(task.id, `[RESUME] Warning: No ready nodes found`)
      }
    }

    // 等待 Workflow 完成
    const finalInstance = await waitForWorkflowCompletion(
      workflow,
      instance.id,
      agent.name,
      log
    )

    const completedAt = now()

    // 关闭 worker
    await closeWorker()

    // 保存输出
    const outputPath = await saveWorkflowOutput(
      {
        task,
        agent,
        workflow,
        instance: finalInstance,
        timing: { startedAt, completedAt },
      },
      { toTaskFolder: saveToTaskFolder }
    )

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

    // 更新 Agent 统计
    store.updateAgent(agent.name, {
      status: 'idle',
      stats: {
        ...agent.stats,
        tasksCompleted: success
          ? agent.stats.tasksCompleted + 1
          : agent.stats.tasksCompleted,
        tasksFailed: success ? agent.stats.tasksFailed : agent.stats.tasksFailed + 1,
      },
    })

    if (success) {
      log(`[${agent.name}] 任务完成: ${task.title}`)
    } else {
      logError(`[${agent.name}] 任务失败: ${task.title}`)
      logError(`[${agent.name}] 错误: ${finalInstance.error}`)
    }
    log(`[${agent.name}] 输出保存至: ${outputPath}`)

    return {
      success,
      workflow,
      instance: finalInstance,
      outputPath,
      timing: { startedAt, completedAt },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError(`[${agent.name}] 执行出错: ${errorMessage}`)

    // 确保关闭 worker
    if (isWorkerRunning()) {
      await closeWorker()
    }

    // 更新任务状态为 failed
    updateTask(task.id, { status: 'failed' })

    // 更新 Agent 状态
    store.updateAgent(agent.name, {
      status: 'idle',
      stats: {
        ...agent.stats,
        tasksFailed: agent.stats.tasksFailed + 1,
      },
    })

    throw error
  }
}

/**
 * 准备新任务执行
 */
async function prepareNewExecution(
  task: Task,
  agent: Agent,
  log: (...args: unknown[]) => void,
  saveToTaskFolder: boolean
): Promise<{ workflow: Workflow }> {
  // 检查是否已有 Workflow（进程崩溃后恢复的情况）
  let workflow = saveToTaskFolder ? getTaskWorkflow(task.id) : null

  if (workflow) {
    log(`[${agent.name}] 发现已有 Workflow: ${workflow.id}，跳过 planning`)
    log(`[${agent.name}] Workflow 节点数: ${workflow.nodes.length}`)
  } else {
    // 更新任务状态为 planning
    updateTask(task.id, {
      status: 'planning',
      assignee: agent.name,
    })
    log(`[${agent.name}] 任务状态: planning`)

    // 生成 Workflow
    const context: AgentContext = { agent, task }
    log(`[${agent.name}] 生成执行计划...`)
    workflow = await generateWorkflow(context)

    // 设置 taskId 以便保存到正确位置
    if (saveToTaskFolder) {
      workflow.taskId = task.id
    }

    // 保存 workflow
    saveWorkflow(workflow)
    log(`[${agent.name}] Workflow 已保存: ${workflow.nodes.length - 2} 个任务节点`)

    // 如果标题是通用的，生成一个描述性标题
    if (isGenericTitle(task.title)) {
      const generatedTitle = await generateTaskTitle(task, workflow)
      task.title = generatedTitle
      updateTask(task.id, { title: generatedTitle })
      log(`[${agent.name}] 生成标题: ${generatedTitle}`)
    }
  }

  return { workflow }
}

/**
 * 准备恢复执行
 */
async function prepareResume(
  task: Task,
  agentName: string,
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

  log(`[${agentName}] 找到 Workflow: ${workflow.id}`)
  log(`[${agentName}] Instance 状态: ${instance.status}`)

  // 记录 resume 到执行日志
  appendExecutionLog(task.id, `[RESUME] Resuming from instance status: ${instance.status}`)

  // 重置所有 running 状态的节点为 pending（它们被中断了）
  const runningNodes = Object.entries(instance.nodeStates)
    .filter(([, state]) => state.status === 'running')
    .map(([nodeId]) => nodeId)

  if (runningNodes.length > 0) {
    log(`[${agentName}] 重置被中断的节点: ${runningNodes.join(', ')}`)
    for (const nodeId of runningNodes) {
      resetNodeState(instance.id, nodeId)
    }
    appendExecutionLog(task.id, `[RESUME] Reset interrupted nodes: ${runningNodes.join(', ')}`)
  }

  // 如果 instance 状态不是 running，更新为 running
  if (instance.status !== 'running') {
    updateInstanceStatus(instance.id, 'running')
    log(`[${agentName}] 更新 instance 状态为 running`)
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
  agentName: string,
  log: (...args: unknown[]) => void
): Promise<WorkflowInstance> {
  let lastProgress = -1

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

    // 打印进度
    const progress = getWorkflowProgress(instance, workflow)
    if (progress.percentage !== lastProgress) {
      log(`[${agentName}] 进度: ${progress.completed}/${progress.total} (${progress.percentage}%)`)
      lastProgress = progress.percentage
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
