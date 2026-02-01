/**
 * Agent 主运行循环
 * 使用 Workflow 系统执行任务
 * @entry
 */

import { getStore } from '../store/index.js'
import { pollTask } from '../task/pollTask.js'
import { generateWorkflow } from './generateWorkflow.js'
import { executeNode } from './executeWorkflowNode.js'
import { now } from '../shared/time.js'
import { generateTaskTitle, isGenericTitle, saveWorkflowOutput } from '../output/index.js'
import {
  saveWorkflow,
  startWorkflow,
  getInstance,
  getWorkflow,
  getWorkflowProgress,
  createNodeWorker,
  startWorker,
  closeWorker,
  isWorkerRunning,
} from '../workflow/index.js'
import type { AgentContext } from '../types/agent.js'
import type { WorkflowInstance } from '../workflow/types.js'

// 轮询间隔
const POLL_INTERVAL = 1000

/**
 * Agent 主运行循环
 *
 * 流程：
 * 1. 轮询获取任务
 * 2. 生成 Workflow (Markdown → Workflow)
 * 3. 启动 Workflow 执行
 * 4. 等待 Workflow 完成
 * 5. 更新任务状态
 */
export async function runAgent(agentName: string): Promise<void> {
  const store = getStore()
  const agent = store.getAgent(agentName)

  if (!agent) {
    throw new Error(`Agent "${agentName}" 不存在`)
  }

  console.log(`[${agent.name}] Agent 启动`)

  // 更新状态为工作中
  store.updateAgent(agent.name, { status: 'working' })

  try {
    // 1. 轮询获取任务
    const task = await pollTask(agent)
    if (!task) {
      console.log(`[${agent.name}] 无待处理任务`)
      store.updateAgent(agent.name, { status: 'idle' })
      return
    }

    console.log(`[${agent.name}] 领取任务: ${task.title}`)
    store.updateTask(task.id, {
      status: 'planning',
      assignee: agent.name
    })

    // 2. 生成 Workflow
    const context: AgentContext = {
      agent,
      task,
    }

    console.log(`[${agent.name}] 生成执行计划...`)
    const workflow = await generateWorkflow(context)

    // 设置 taskId，让 workflow 保存到 task 目录
    workflow.taskId = task.id

    // 保存 workflow
    saveWorkflow(workflow)
    console.log(`[${agent.name}] Workflow 创建: ${workflow.name} (${workflow.nodes.length - 2} 个任务节点)`)

    // 如果标题是通用的，生成一个描述性标题
    if (isGenericTitle(task.title)) {
      const generatedTitle = await generateTaskTitle(task, workflow)
      task.title = generatedTitle
      store.updateTask(task.id, { title: generatedTitle })
      console.log(`[${agent.name}] 生成标题: ${generatedTitle}`)
    }

    store.updateTask(task.id, {
      status: 'developing',
      workflowId: workflow.id,
    })

    // 3. 启动 Workflow
    const startedAt = now()

    // 先启动 workflow 获取 instance
    const instance = await startWorkflow(workflow.id)
    console.log(`[${agent.name}] Workflow 启动: ${instance.id}`)

    // 创建并启动 NodeWorker（绑定到该 instance，实现队列隔离）
    createNodeWorker({
      concurrency: 1, // Agent 一次只处理一个节点
      pollInterval: POLL_INTERVAL,
      processor: executeNode,
      instanceId: instance.id,
    })
    await startWorker()

    // 4. 等待 Workflow 完成
    const finalInstance = await waitForWorkflowCompletion(
      workflow.id,
      instance.id,
      agent.name
    )

    const completedAt = now()

    // 关闭 worker
    await closeWorker()

    // 5. 保存输出
    const outputPath = await saveWorkflowOutput({
      task,
      agent,
      workflow,
      instance: finalInstance,
      timing: { startedAt, completedAt }
    })

    // 6. 更新任务状态
    const success = finalInstance.status === 'completed'

    store.updateTask(task.id, {
      status: success ? 'completed' : 'failed',
      output: {
        workflowId: workflow.id,
        instanceId: finalInstance.id,
        finalStatus: finalInstance.status,
        timing: { startedAt, completedAt }
      }
    })

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
      }
    })

    if (success) {
      console.log(`[${agent.name}] 任务完成: ${task.title}`)
    } else {
      console.log(`[${agent.name}] 任务失败: ${task.title}`)
      console.log(`[${agent.name}] 错误: ${finalInstance.error}`)
    }
    console.log(`[${agent.name}] 输出保存至: ${outputPath}`)

  } catch (error) {
    console.error(`[${agent.name}] 执行出错:`, error)

    // 确保关闭 worker
    if (isWorkerRunning()) {
      await closeWorker()
    }

    store.updateAgent(agent.name, {
      status: 'idle',
      stats: {
        ...agent.stats,
        tasksFailed: agent.stats.tasksFailed + 1
      }
    })
  }
}

/**
 * 等待 Workflow 完成
 */
async function waitForWorkflowCompletion(
  workflowId: string,
  instanceId: string,
  agentName: string
): Promise<WorkflowInstance> {
  const workflow = getWorkflow(workflowId)!

  let lastProgress = -1

  while (true) {
    await sleep(POLL_INTERVAL)

    const instance = getInstance(instanceId)
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`)
    }

    // 检查是否完成
    if (instance.status === 'completed' || instance.status === 'failed' || instance.status === 'cancelled') {
      return instance
    }

    // 打印进度
    const progress = getWorkflowProgress(instance, workflow)
    if (progress.percentage !== lastProgress) {
      console.log(`[${agentName}] 进度: ${progress.completed}/${progress.total} (${progress.percentage}%)`)
      lastProgress = progress.percentage
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
