/**
 * 任务数据收集器
 * 收集任务执行快照
 */

import { readdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { TASKS_DIR } from '../../store/paths.js'
import { readJson } from '../../store/readWriteJson.js'
import type { ExecutionSummary } from '../../store/ExecutionStatsStore.js'
import type { TaskCategory } from '../../analysis/index.js'
import type { TaskExecutionSnapshot } from './types.js'

/**
 * 任务类型分类
 */
export function categorizeTask(
  title: string,
  description?: string
): TaskCategory {
  const text = `${title} ${description || ''}`.toLowerCase()

  if (/commit|push|pull|merge|提交|推送|合并/.test(text)) return 'git'
  if (/迭代|进化|iteration|evolution|cycle|周期/.test(text)) return 'iteration'
  if (/refactor|重构|优化|整理|reorganize/.test(text)) return 'refactor'
  if (/fix|bug|修复|修正|repair/.test(text)) return 'fix'
  if (/test|测试|spec|unittest/.test(text)) return 'test'
  if (/doc|文档|readme|changelog/.test(text)) return 'docs'
  if (/add|feature|implement|新增|添加|实现|功能/.test(text)) return 'feature'

  return 'other'
}

/**
 * 收集任务执行快照
 */
export function collectTaskSnapshots(
  daysBack: number = 30
): TaskExecutionSnapshot[] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const snapshots: TaskExecutionSnapshot[] = []

  for (const folder of taskFolders) {
    const snapshot = collectSingleTaskSnapshot(folder, cutoffDate)
    if (snapshot) {
      snapshots.push(snapshot)
    }
  }

  return snapshots.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

function collectSingleTaskSnapshot(
  folder: string,
  cutoffDate: Date
): TaskExecutionSnapshot | null {
  const taskPath = join(TASKS_DIR, folder)
  const taskJsonPath = join(taskPath, 'task.json')
  const statsPath = join(taskPath, 'stats.json')
  const workflowPath = join(taskPath, 'workflow.json')
  const instancePath = join(taskPath, 'instance.json')

  if (!existsSync(taskJsonPath)) return null

  const taskJson = readJson<{
    id: string
    title: string
    description?: string
    createdAt: string
    status: string
  }>(taskJsonPath, { defaultValue: null })
  if (!taskJson) return null

  const createdAt = new Date(taskJson.createdAt)
  if (createdAt < cutoffDate) return null

  // 只分析已完成的任务
  if (taskJson.status !== 'completed' && taskJson.status !== 'failed')
    return null

  // 读取统计数据
  const stats = readJson<{ summary: ExecutionSummary }>(statsPath, {
    defaultValue: null,
  })

  // 计算执行时长
  let durationMs = 0
  if (stats?.summary?.totalDurationMs) {
    durationMs = stats.summary.totalDurationMs
  } else if (existsSync(instancePath)) {
    const instance = readJson<{ startedAt?: string; completedAt?: string }>(
      instancePath,
      { defaultValue: null }
    )
    if (instance?.startedAt && instance?.completedAt) {
      durationMs =
        new Date(instance.completedAt).getTime() -
        new Date(instance.startedAt).getTime()
    }
  }

  // 读取节点名称
  let nodeNames: string[] = []
  if (existsSync(workflowPath)) {
    try {
      const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'))
      if (workflow.nodes && Array.isArray(workflow.nodes)) {
        nodeNames = workflow.nodes
          .filter((n: { type?: string }) => n.type === 'task')
          .map((n: { name?: string }) => n.name || 'unnamed')
      }
    } catch {
      // ignore
    }
  }

  const category = categorizeTask(taskJson.title, taskJson.description)

  return {
    taskId: folder,
    title: taskJson.title,
    category,
    status: taskJson.status,
    createdAt,
    durationMs,
    costUsd: stats?.summary?.totalCostUsd || 0,
    nodeCount: stats?.summary?.nodesTotal || nodeNames.length,
    nodeNames,
    successRate: taskJson.status === 'completed' ? 100 : 0,
  }
}
