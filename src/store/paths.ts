/**
 * 统一存储路径常量
 *
 * 所有存储相关的路径都从这里导出，确保一致性。
 *
 * 数据目录优先级：
 * 1. 环境变量 CAH_DATA_DIR
 * 2. 默认值 .cah-data
 */

import { join } from 'path'

// ============ 数据目录配置 ============

/** 默认数据目录名 */
const DEFAULT_DATA_DIR_NAME = '.cah-data'

/** 获取数据目录路径 */
function getDataDir(): string {
  const envDir = process.env.CAH_DATA_DIR
  if (envDir) {
    // 如果是绝对路径直接使用，否则相对于 cwd
    return envDir.startsWith('/') ? envDir : join(process.cwd(), envDir)
  }
  return join(process.cwd(), DEFAULT_DATA_DIR_NAME)
}

// ============ 基础目录 ============

/** 主数据目录 */
export const DATA_DIR = getDataDir()

/** 任务目录 */
export const TASKS_DIR = join(DATA_DIR, 'tasks')

// ============ 全局文件 ============

/** 元数据文件 */
export const META_FILE = join(DATA_DIR, 'meta.json')

/** 队列文件（替代 SQLite） */
export const QUEUE_FILE = join(DATA_DIR, 'queue.json')

/** 队列运行器锁文件 */
export const RUNNER_LOCK_FILE = join(DATA_DIR, 'runner.lock')

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

/** JSON Lines 结构化日志文件名 */
export const JSONL_LOG_FILE = 'events.jsonl'

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

/** 获取 JSON Lines 结构化日志文件路径 */
export function getJsonlLogPath(taskId: string): string {
  return join(TASKS_DIR, taskId, TASK_LOGS_DIR, JSONL_LOG_FILE)
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

