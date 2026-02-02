/**
 * 执行指定任务
 *
 * 任务执行入口函数：
 * 1. 直接接收 task（不轮询）
 * 2. 保存 workflow 到任务文件夹
 * 3. 保存输出到任务文件夹
 * 4. 用于后台进程执行
 */

import { executeTask } from './executeTask.js'
import type { Task } from '../types/task.js'

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
export async function runTask(task: Task): Promise<void> {
  await executeTask(task, {
    concurrency: NODE_CONCURRENCY,
    saveToTaskFolder: true,
    useConsole: false, // 使用 logger
  })
}

/**
 * 恢复中断/失败的任务
 *
 * 与 runTask 不同，这个函数：
 * 1. 使用已有的 workflow（不重新生成）
 * 2. 继续执行现有的 instance
 * 3. 从上次停止的节点继续执行
 */
export async function resumeTask(task: Task): Promise<void> {
  await executeTask(task, {
    concurrency: NODE_CONCURRENCY,
    resume: true,
    saveToTaskFolder: true,
    useConsole: false, // 使用 logger
  })
}

