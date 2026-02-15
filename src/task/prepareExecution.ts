/**
 * Task execution preparation - new execution and resume logic
 */

import { generateWorkflow } from '../workflow/generateWorkflow.js'
import { generateTaskTitle, isGenericTitle } from '../output/index.js'
import { getActiveNodes } from '../workflow/index.js'
import {
  saveWorkflow,
  getInstance,
  resetNodeState,
  updateInstanceStatus,
} from '../store/WorkflowStore.js'
import { updateTask } from '../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../store/TaskWorkflowStore.js'
import { appendExecutionLog } from '../store/TaskLogStore.js'
import { appendTimelineEvent } from '../store/ExecutionStatsStore.js'
import { createLogger } from '../shared/logger.js'
import type { Task } from '../types/task.js'
import type { Workflow, WorkflowInstance } from '../workflow/types.js'

const logger = createLogger('prepare-execution')

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

/**
 * 准备新任务执行
 */
export async function prepareNewExecution(task: Task): Promise<{ workflow: Workflow }> {
  // 检查是否已有 Workflow（进程崩溃后恢复的情况）
  let workflow = getTaskWorkflow(task.id)

  if (workflow) {
    logger.info(`发现已有 Workflow: ${workflow.id}，跳过 planning`)
    logger.info(`Workflow 节点数: ${workflow.nodes.length}`)
  } else {
    // 更新任务状态为 planning
    updateTask(task.id, {
      status: 'planning',
    })
    logger.info(`任务状态: planning`)
    appendExecutionLog(task.id, `[STATUS] pending → planning`, { scope: 'lifecycle' })

    // 生成 Workflow
    logger.info(`生成执行计划...`)
    try {
      workflow = await generateWorkflow(task)
    } catch (error) {
      // Planning 失败时，记录详细错误到 execution.log
      const errorMsg = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      const errorCause = error instanceof Error && error.cause
        ? (error.cause instanceof Error ? error.cause.message : String(error.cause))
        : undefined

      logger.error(`Workflow 生成失败: ${errorMsg}`)
      appendExecutionLog(task.id, `[ERROR] Workflow generation failed: ${errorMsg}`, {
        level: 'error',
        scope: 'lifecycle',
      })

      if (errorCause) {
        appendExecutionLog(task.id, `[ERROR] Caused by: ${errorCause}`, {
          level: 'error',
          scope: 'lifecycle',
        })
      }

      if (errorStack) {
        appendExecutionLog(task.id, `[ERROR] Stack trace:\n${errorStack}`, {
          level: 'error',
          scope: 'lifecycle',
        })
      }

      // 更新任务状态为 failed
      appendExecutionLog(task.id, `[STATUS] planning → failed`, {
        level: 'error',
        scope: 'lifecycle',
      })

      // 重新抛出错误，让上层处理
      throw error
    }

    // 设置 taskId 以便保存到正确位置
    workflow.taskId = task.id

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
export async function prepareResume(
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
