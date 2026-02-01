/**
 * 统一存储路径常量
 *
 * 所有存储相关的路径都从这里导出，确保一致性。
 * 使用 process.cwd() 作为基础路径。
 */

import { join } from 'path'

// ============ 基础目录 ============

/** 主数据目录 */
export const DATA_DIR = join(process.cwd(), 'data')

/** 任务目录 */
export const TASKS_DIR = join(DATA_DIR, 'tasks')

/** Agent 目录 */
export const AGENTS_DIR = join(DATA_DIR, 'agents')

// ============ 全局文件 ============

/** 元数据文件 */
export const META_FILE = join(DATA_DIR, 'meta.json')

/** 队列文件（替代 SQLite） */
export const QUEUE_FILE = join(DATA_DIR, 'queue.json')

/** 任务索引文件 */
export const TASKS_INDEX_FILE = join(TASKS_DIR, 'index.json')

// ============ 任务子目录名称常量 ============

/** 日志目录名 */
export const TASK_LOGS_DIR = 'logs'

/** 输出目录名 */
export const TASK_OUTPUTS_DIR = 'outputs'

/** 步骤目录名 */
export const TASK_STEPS_DIR = 'steps'

// ============ 任务文件名常量 ============

/** 任务元数据文件名 */
export const TASK_FILE = 'task.json'

/** Workflow 文件名 */
export const WORKFLOW_FILE = 'workflow.json'

/** Workflow 实例文件名 */
export const INSTANCE_FILE = 'instance.json'

/** 进程信息文件名 */
export const PROCESS_FILE = 'process.json'

/** 执行日志文件名 */
export const EXECUTION_LOG_FILE = 'execution.log'

/** 对话日志文件名 */
export const CONVERSATION_LOG_FILE = 'conversation.log'

/** 输出结果文件名 */
export const RESULT_FILE = 'result.md'

// ============ 路径构建函数 ============

/** 获取任务目录路径 */
export function getTaskDir(taskId: string): string {
  return join(TASKS_DIR, taskId)
}

/** 获取任务文件路径 */
export function getTaskFilePath(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_FILE)
}

/** 获取任务日志目录路径 */
export function getTaskLogsDir(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_LOGS_DIR)
}

/** 获取任务输出目录路径 */
export function getTaskOutputsDir(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_OUTPUTS_DIR)
}

/** 获取任务步骤目录路径 */
export function getTaskStepsDir(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_STEPS_DIR)
}

/** 获取 Workflow 文件路径 */
export function getWorkflowFilePath(taskId: string): string {
  return join(TASKS_DIR, taskId, WORKFLOW_FILE)
}

/** 获取 Instance 文件路径 */
export function getInstanceFilePath(taskId: string): string {
  return join(TASKS_DIR, taskId, INSTANCE_FILE)
}

/** 获取进程信息文件路径 */
export function getProcessFilePath(taskId: string): string {
  return join(TASKS_DIR, taskId, PROCESS_FILE)
}

/** 获取执行日志文件路径 */
export function getExecutionLogPath(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_LOGS_DIR, EXECUTION_LOG_FILE)
}

/** 获取对话日志文件路径 */
export function getConversationLogFilePath(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_LOGS_DIR, CONVERSATION_LOG_FILE)
}

/** 获取输出结果文件路径 */
export function getResultFilePath(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_OUTPUTS_DIR, RESULT_FILE)
}

/** 获取步骤文件路径 */
export function getStepFilePath(taskId: string, stepNumber: number): string {
  const paddedNumber = stepNumber.toString().padStart(3, '0')
  return join(TASKS_DIR, taskId, TASK_STEPS_DIR, `step-${paddedNumber}.json`)
}

/** 获取 Agent 文件路径 */
export function getAgentFilePath(agentName: string): string {
  return join(AGENTS_DIR, `${agentName}.json`)
}
