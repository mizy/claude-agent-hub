/**
 * 执行指定任务
 *
 * 与 runAgent 不同，这个函数：
 * 1. 直接接收 task（不轮询）
 * 2. 保存 workflow 到任务文件夹
 * 3. 保存输出到任务文件夹
 * 4. 用于后台进程执行
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
  getReadyNodes,
  resetNodeState,
  updateInstanceStatus,
  enqueueNodes,
} from '../workflow/index.js'
import {
  updateTask,
  getTaskWorkflow,
  getTaskInstance,
  appendExecutionLog,
} from '../store/TaskStore.js'
import { saveWorkflowOutputToTask } from '../output/saveWorkflowOutputToTask.js'
import { createLogger } from '../shared/logger.js'
import type { Agent, AgentContext } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('run-agent')

// 轮询间隔（毫秒）
const POLL_INTERVAL = 500

// 工作流内节点并发数（parallel 节点可以并行执行）
const NODE_CONCURRENCY = 3

/**
 * 执行指定任务
 *
 * 流程：
 * 1. 检查是否已有 Workflow（支持从中断处继续）
 * 2. 如果没有 Workflow，更新任务状态为 planning 并生成
 * 3. 保存 Workflow 到任务文件夹
 * 4. 执行 Workflow
 * 5. 保存输出到任务文件夹
 * 6. 更新任务状态
 */
export async function runAgentForTask(agent: Agent, task: Task): Promise<void> {
  const store = getStore()

  logger.info(`[${agent.name}] 开始执行任务: ${task.title}`)

  // 更新 Agent 状态
  store.updateAgent(agent.name, { status: 'working' })

  try {
    // 1. 检查是否已有 Workflow（进程崩溃后恢复的情况）
    let workflow = getTaskWorkflow(task.id)

    if (workflow) {
      // 已有 Workflow，跳过 planning 阶段
      logger.info(`[${agent.name}] 发现已有 Workflow: ${workflow.id}，跳过 planning`)
      logger.info(`[${agent.name}] Workflow 节点数: ${workflow.nodes.length}`)
    } else {
      // 2. 没有 Workflow，更新任务状态为 planning 并生成
      updateTask(task.id, {
        status: 'planning',
        assignee: agent.name,
      })
      logger.info(`[${agent.name}] 任务状态: planning`)

      // 生成 Workflow
      const context: AgentContext = { agent, task }

      logger.info(`[${agent.name}] 生成执行计划...`)
      workflow = await generateWorkflow(context)

      // 3. 设置 taskId 并保存 Workflow（会自动保存到 task 目录）
      workflow.taskId = task.id
      saveWorkflow(workflow)
      logger.info(`[${agent.name}] Workflow 已保存: ${workflow.nodes.length - 2} 个任务节点`)

      // 如果标题是通用的，生成一个描述性标题
      if (isGenericTitle(task.title)) {
        const generatedTitle = await generateTaskTitle(task, workflow)
        task.title = generatedTitle
        updateTask(task.id, { title: generatedTitle })
        logger.info(`[${agent.name}] 生成标题: ${generatedTitle}`)
      }
    }

    // 4. 更新任务状态为 developing
    updateTask(task.id, {
      status: 'developing',
      workflowId: workflow.id,
    })
    logger.info(`[${agent.name}] 任务状态: developing`)

    // 5. 启动 Workflow 执行
    const startedAt = now()

    // 先启动 workflow 获取 instance，再创建绑定到该 instance 的 worker
    const instance = await startWorkflowFromTask(task.id, workflow)
    logger.info(`[${agent.name}] Workflow 启动: ${instance.id}`)

    // 创建并启动 NodeWorker（绑定到该 instance，实现队列隔离）
    createNodeWorker({
      concurrency: NODE_CONCURRENCY,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    // 6. 等待 Workflow 完成
    const finalInstance = await waitForWorkflowCompletion(
      task.id,
      workflow.id,
      instance.id,
      agent.name
    )

    const completedAt = now()

    // 关闭 worker
    await closeWorker()

    // 7. 保存输出到任务文件夹
    const outputPath = await saveWorkflowOutputToTask({
      task,
      agent,
      workflow,
      instance: finalInstance,
      timing: { startedAt, completedAt },
    })

    // 8. 更新任务状态
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
        tasksFailed: success
          ? agent.stats.tasksFailed
          : agent.stats.tasksFailed + 1,
      },
    })

    if (success) {
      logger.info(`[${agent.name}] 任务完成: ${task.title}`)
    } else {
      logger.error(`[${agent.name}] 任务失败: ${task.title}`)
      logger.error(`[${agent.name}] 错误: ${finalInstance.error}`)
    }
    logger.info(`[${agent.name}] 输出保存至: ${outputPath}`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`[${agent.name}] 执行出错: ${errorMessage}`)

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

    throw error // 重新抛出让调用者处理
  }
}

/**
 * 启动 workflow（使用任务文件夹内的数据）
 */
async function startWorkflowFromTask(
  _taskId: string,
  workflow: import('../workflow/types.js').Workflow
): Promise<WorkflowInstance> {
  // 创建并启动实例（会自动保存到 task 目录，因为 workflow 有 taskId）
  const instance = await startWorkflow(workflow.id)
  return instance
}

/**
 * 等待 Workflow 完成
 */
async function waitForWorkflowCompletion(
  taskId: string,
  _workflowId: string,
  instanceId: string,
  agentName: string
): Promise<WorkflowInstance> {
  const workflow = getTaskWorkflow(taskId)!

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
      logger.info(
        `[${agentName}] 进度: ${progress.completed}/${progress.total} (${progress.percentage}%)`
      )
      lastProgress = progress.percentage
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 恢复中断/失败的任务
 *
 * 与 runAgentForTask 不同，这个函数：
 * 1. 使用已有的 workflow（不重新生成）
 * 2. 继续执行现有的 instance
 * 3. 从上次停止的节点继续执行
 */
export async function resumeAgentForTask(agent: Agent, task: Task): Promise<void> {
  const store = getStore()

  logger.info(`[${agent.name}] 恢复任务: ${task.title}`)

  // 获取已有的 workflow 和 instance
  const workflow = getTaskWorkflow(task.id)
  let instance = getTaskInstance(task.id)

  if (!workflow) {
    throw new Error(`No workflow found for task: ${task.id}`)
  }

  if (!instance) {
    throw new Error(`No instance found for task: ${task.id}`)
  }

  logger.info(`[${agent.name}] 找到 Workflow: ${workflow.id}`)
  logger.info(`[${agent.name}] Instance 状态: ${instance.status}`)

  // 记录 resume 到执行日志
  appendExecutionLog(task.id, `[RESUME] Resuming from instance status: ${instance.status}`)

  // 更新 Agent 状态
  store.updateAgent(agent.name, { status: 'working' })

  try {
    // 更新任务状态为 developing
    updateTask(task.id, { status: 'developing' })
    logger.info(`[${agent.name}] 任务状态: developing`)

    const startedAt = now()

    // 1. 重置所有 running 状态的节点为 pending（它们被中断了）
    const runningNodes = Object.entries(instance.nodeStates)
      .filter(([, state]) => state.status === 'running')
      .map(([nodeId]) => nodeId)

    if (runningNodes.length > 0) {
      logger.info(`[${agent.name}] 重置被中断的节点: ${runningNodes.join(', ')}`)
      for (const nodeId of runningNodes) {
        resetNodeState(instance.id, nodeId)
      }
      appendExecutionLog(task.id, `[RESUME] Reset interrupted nodes: ${runningNodes.join(', ')}`)
    }

    // 2. 如果 instance 状态不是 running，更新为 running
    if (instance.status !== 'running') {
      updateInstanceStatus(instance.id, 'running')
      logger.info(`[${agent.name}] 更新 instance 状态为 running`)
    }

    // 重新获取更新后的 instance
    instance = getInstance(instance.id)!

    // 创建并启动 NodeWorker（绑定到该 instance，实现队列隔离）
    createNodeWorker({
      concurrency: NODE_CONCURRENCY,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    // 3. 获取所有可执行的节点并入队
    const readyNodes = getReadyNodes(workflow, instance)

    if (readyNodes.length > 0) {
      logger.info(`[${agent.name}] 恢复执行节点: ${readyNodes.join(', ')}`)
      appendExecutionLog(task.id, `[RESUME] Enqueuing ready nodes: ${readyNodes.join(', ')}`)

      await enqueueNodes(
        readyNodes.map(nodeId => ({
          data: {
            workflowId: workflow.id,
            instanceId: instance!.id,
            nodeId,
            attempt: 1,
          },
        }))
      )
    } else {
      logger.warn(`[${agent.name}] 没有可执行的节点`)
      appendExecutionLog(task.id, `[RESUME] Warning: No ready nodes found`)
    }

    // 等待 Workflow 完成
    const finalInstance = await waitForWorkflowCompletion(
      task.id,
      workflow.id,
      instance.id,
      agent.name
    )

    const completedAt = now()

    // 关闭 worker
    await closeWorker()

    // 保存输出到任务文件夹
    const outputPath = await saveWorkflowOutputToTask({
      task,
      agent,
      workflow,
      instance: finalInstance,
      timing: { startedAt, completedAt },
    })

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
        tasksFailed: success
          ? agent.stats.tasksFailed
          : agent.stats.tasksFailed + 1,
      },
    })

    if (success) {
      logger.info(`[${agent.name}] 任务完成: ${task.title}`)
    } else {
      logger.error(`[${agent.name}] 任务失败: ${task.title}`)
      logger.error(`[${agent.name}] 错误: ${finalInstance.error}`)
    }
    logger.info(`[${agent.name}] 输出保存至: ${outputPath}`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`[${agent.name}] 恢复出错: ${errorMessage}`)

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
