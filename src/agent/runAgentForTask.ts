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
} from '../workflow/index.js'
import {
  updateTask,
  getTaskWorkflow,
  getTaskInstance,
  getOutputPath,
} from '../store/TaskStore.js'
import { enqueueNode } from '../workflow/index.js'
import { saveWorkflowOutputToTask } from '../output/saveWorkflowOutputToTask.js'
import { createLogger } from '../shared/logger.js'
import type { Agent, AgentContext } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('run-agent')

// 轮询间隔
const POLL_INTERVAL = 1000

/**
 * 执行指定任务
 *
 * 流程：
 * 1. 更新任务状态为 planning
 * 2. 生成 Workflow
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
    // 1. 更新任务状态为 planning
    updateTask(task.id, {
      status: 'planning',
      assignee: agent.name,
    })
    logger.info(`[${agent.name}] 任务状态: planning`)

    // 2. 生成 Workflow
    const context: AgentContext = { agent, task }

    logger.info(`[${agent.name}] 生成执行计划...`)
    const workflow = await generateWorkflow(context)

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

    // 4. 更新任务状态为 developing
    updateTask(task.id, {
      status: 'developing',
      workflowId: workflow.id,
    })
    logger.info(`[${agent.name}] 任务状态: developing`)

    // 5. 启动 Workflow 执行
    const startedAt = now()

    // 创建并启动 NodeWorker
    createNodeWorker({
      concurrency: 1,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
    })
    await startWorker()

    // 启动 workflow 执行（使用任务文件夹内的 workflow）
    const instance = await startWorkflowFromTask(task.id, workflow)
    logger.info(`[${agent.name}] Workflow 启动: ${instance.id}`)

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
 * 恢复失败的任务
 *
 * 与 runAgentForTask 不同，这个函数：
 * 1. 使用已有的 workflow（不重新生成）
 * 2. 继续执行现有的 instance
 * 3. 从失败点恢复执行
 */
export async function resumeAgentForTask(agent: Agent, task: Task): Promise<void> {
  const store = getStore()

  logger.info(`[${agent.name}] 恢复任务: ${task.title}`)

  // 获取已有的 workflow 和 instance
  const workflow = getTaskWorkflow(task.id)
  const instance = getTaskInstance(task.id)

  if (!workflow) {
    throw new Error(`No workflow found for task: ${task.id}`)
  }

  if (!instance) {
    throw new Error(`No instance found for task: ${task.id}`)
  }

  logger.info(`[${agent.name}] 找到 Workflow: ${workflow.id}`)
  logger.info(`[${agent.name}] Instance 状态: ${instance.status}`)

  // 更新 Agent 状态
  store.updateAgent(agent.name, { status: 'working' })

  try {
    // 更新任务状态为 developing
    updateTask(task.id, { status: 'developing' })
    logger.info(`[${agent.name}] 任务状态: developing`)

    const startedAt = now()

    // 创建并启动 NodeWorker
    createNodeWorker({
      concurrency: 1,
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
    })
    await startWorker()

    // 找到需要重新执行的节点并入队
    // instance.status 应该已经被 recoverWorkflowInstance 设为 running
    // 失败的节点也应该被重置
    const pendingNodes = Object.entries(instance.nodeStates)
      .filter(([_, state]) => state.status === 'pending' && state.attempts === 0)
      .map(([nodeId]) => nodeId)

    if (pendingNodes.length > 0) {
      // 只入队第一个 pending 节点（通常是循环节点）
      const nodeToResume = pendingNodes[0]!
      logger.info(`[${agent.name}] 恢复节点: ${nodeToResume}`)

      await enqueueNode({
        workflowId: workflow.id,
        instanceId: instance.id,
        nodeId: nodeToResume,
        attempt: 1,
      })
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
