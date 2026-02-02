/**
 * 统一存储路径常量
 *
 * 所有存储相关的路径都从这里导出，确保一致性。
 *
 * 数据目录优先级：
 * 1. 环境变量 CAH_DATA_DIR
 * 2. 默认值 .cah-data
 *
 * 导出结构:
 * - 核心常量: DATA_DIR, TASKS_DIR, QUEUE_FILE, RUNNER_LOCK_FILE
 * - 文件名: FILE_NAMES.TASK, FILE_NAMES.WORKFLOW, 等
 * - 路径函数: TaskPaths.getDir(), TaskPaths.getFilePath(), 等
 */

import { join } from 'path'

// ============ 数据目录配置 ============

const DEFAULT_DATA_DIR_NAME = '.cah-data'

function getDataDir(): string {
  const envDir = process.env.CAH_DATA_DIR
  if (envDir) {
    return envDir.startsWith('/') ? envDir : join(process.cwd(), envDir)
  }
  return join(process.cwd(), DEFAULT_DATA_DIR_NAME)
}

// ============ 核心目录常量（直接导出） ============

/** 主数据目录 */
export const DATA_DIR = getDataDir()

/** 任务目录 */
export const TASKS_DIR = join(DATA_DIR, 'tasks')

// ============ 全局文件常量（直接导出） ============

/** 队列文件 */
export const QUEUE_FILE = join(DATA_DIR, 'queue.json')

/** 队列运行器锁文件 */
export const RUNNER_LOCK_FILE = join(DATA_DIR, 'runner.lock')

/** 队列运行器日志文件 */
export const RUNNER_LOG_FILE = join(DATA_DIR, 'runner.log')

// ============ 文件名常量（聚合导出） ============

/** 文件名常量集合 */
export const FILE_NAMES = {
  TASK: 'task.json',
  WORKFLOW: 'workflow.json',
  INSTANCE: 'instance.json',
  PROCESS: 'process.json',
  EXECUTION_LOG: 'execution.log',
  CONVERSATION_LOG: 'conversation.log',
  EVENTS_JSONL: 'events.jsonl',
  CONVERSATION_JSONL: 'conversation.jsonl',
  RESULT: 'result.md',
  META: 'meta.json',
  TASKS_INDEX: 'index.json',
} as const

/** 子目录名常量 */
export const DIR_NAMES = {
  LOGS: 'logs',
  OUTPUTS: 'outputs',
  /** @deprecated steps 目录已不再使用 */
  STEPS: 'steps',
} as const

// ============ 路径构建函数（聚合导出） ============

/** 任务路径工具集合 */
export const TASK_PATHS = {
  /** 获取任务目录 */
  getDir: (taskId: string) => join(TASKS_DIR, taskId),
  /** 获取任务文件路径 */
  getFilePath: (taskId: string) => join(TASKS_DIR, taskId, FILE_NAMES.TASK),
  /** 获取日志目录 */
  getLogsDir: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.LOGS),
  /** 获取输出目录 */
  getOutputsDir: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.OUTPUTS),
  /** @deprecated steps 目录已不再使用 */
  getStepsDir: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.STEPS),
  /** 获取 Workflow 文件路径 */
  getWorkflowPath: (taskId: string) => join(TASKS_DIR, taskId, FILE_NAMES.WORKFLOW),
  /** 获取 Instance 文件路径 */
  getInstancePath: (taskId: string) => join(TASKS_DIR, taskId, FILE_NAMES.INSTANCE),
  /** 获取进程信息文件路径 */
  getProcessPath: (taskId: string) => join(TASKS_DIR, taskId, FILE_NAMES.PROCESS),
  /** 获取执行日志路径 */
  getExecutionLogPath: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.LOGS, FILE_NAMES.EXECUTION_LOG),
  /** 获取对话日志路径 */
  getConversationLogPath: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.LOGS, FILE_NAMES.CONVERSATION_LOG),
  /** 获取 JSONL 日志路径 */
  getJsonlLogPath: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.LOGS, FILE_NAMES.EVENTS_JSONL),
  /** 获取对话 JSONL 路径 */
  getConversationJsonlPath: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.LOGS, FILE_NAMES.CONVERSATION_JSONL),
  /** 获取结果文件路径 */
  getResultPath: (taskId: string) => join(TASKS_DIR, taskId, DIR_NAMES.OUTPUTS, FILE_NAMES.RESULT),
  /** @deprecated steps 目录已不再使用 */
  getStepPath: (taskId: string, stepNumber: number) => {
    const paddedNumber = stepNumber.toString().padStart(3, '0')
    return join(TASKS_DIR, taskId, DIR_NAMES.STEPS, `step-${paddedNumber}.json`)
  },
}

// ============ 兼容性别名（保留旧 API） ============

// 文件名常量（保留单独导出以兼容）
export const META_FILE = join(DATA_DIR, FILE_NAMES.META)
export const TASKS_INDEX_FILE = join(TASKS_DIR, FILE_NAMES.TASKS_INDEX)
export const TASK_LOGS_DIR = DIR_NAMES.LOGS
export const TASK_OUTPUTS_DIR = DIR_NAMES.OUTPUTS
/** @deprecated steps 目录已不再使用 */
export const TASK_STEPS_DIR = DIR_NAMES.STEPS
export const TASK_FILE = FILE_NAMES.TASK
export const WORKFLOW_FILE = FILE_NAMES.WORKFLOW
export const INSTANCE_FILE = FILE_NAMES.INSTANCE
export const PROCESS_FILE = FILE_NAMES.PROCESS
export const EXECUTION_LOG_FILE = FILE_NAMES.EXECUTION_LOG
export const CONVERSATION_LOG_FILE = FILE_NAMES.CONVERSATION_LOG
export const JSONL_LOG_FILE = FILE_NAMES.EVENTS_JSONL
export const CONVERSATION_JSONL_FILE = FILE_NAMES.CONVERSATION_JSONL
export const RESULT_FILE = FILE_NAMES.RESULT

// 路径函数（保留单独导出以兼容）
export const getTaskDir = TASK_PATHS.getDir
export const getTaskFilePath = TASK_PATHS.getFilePath
export const getTaskLogsDir = TASK_PATHS.getLogsDir
export const getTaskOutputsDir = TASK_PATHS.getOutputsDir
/** @deprecated steps 目录已不再使用 */
export const getTaskStepsDir = TASK_PATHS.getStepsDir
export const getWorkflowFilePath = TASK_PATHS.getWorkflowPath
export const getInstanceFilePath = TASK_PATHS.getInstancePath
export const getProcessFilePath = TASK_PATHS.getProcessPath
export const getExecutionLogPath = TASK_PATHS.getExecutionLogPath
export const getConversationLogFilePath = TASK_PATHS.getConversationLogPath
export const getJsonlLogPath = TASK_PATHS.getJsonlLogPath
export const getConversationJsonlPath = TASK_PATHS.getConversationJsonlPath
export const getResultFilePath = TASK_PATHS.getResultPath
/** @deprecated steps 目录已不再使用 */
export const getStepFilePath = TASK_PATHS.getStepPath

