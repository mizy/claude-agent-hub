/**
 * 数据收集器
 * 收集和预处理任务统计数据
 */

import { readdirSync, existsSync, readFileSync } from 'fs'
import { TASKS_DIR } from '../../store/paths.js'
import { readJson } from '../../store/readWriteJson.js'
import type { ExecutionSummary, ExecutionTimeline } from '../../task/index.js'
import type { NodeExecutionStats } from '../../workflow/engine/WorkflowEventEmitter.js'
import { categorizeTask } from '../../analysis/index.js'
import type { TaskStats } from './types.js'

/**
 * 读取所有任务统计数据
 */
export function collectAllTaskStats(daysBack: number = 30): TaskStats[] {
  if (!existsSync(TASKS_DIR)) {
    return []
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  const taskFolders = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('task-'))
    .map(d => d.name)

  const stats: TaskStats[] = []

  for (const folder of taskFolders) {
    const taskPath = `${TASKS_DIR}/${folder}`
    const statsPath = `${taskPath}/stats.json`
    const timelinePath = `${taskPath}/timeline.json`
    const taskJsonPath = `${taskPath}/task.json`
    const workflowPath = `${taskPath}/workflow.json`

    if (!existsSync(statsPath)) continue

    // 读取任务信息
    const taskJson = existsSync(taskJsonPath)
      ? readJson<{ createdAt: string; title?: string; description?: string }>(taskJsonPath, {
          defaultValue: null,
        })
      : null
    if (!taskJson?.createdAt) continue

    const createdAt = new Date(taskJson.createdAt)
    if (createdAt < cutoffDate) continue

    // 读取统计数据
    const statsData = readJson<{ summary: ExecutionSummary; nodes: NodeExecutionStats[] }>(
      statsPath,
      { defaultValue: null }
    )
    if (!statsData?.summary) continue

    // 读取时间线
    const timeline = existsSync(timelinePath)
      ? (readJson<ExecutionTimeline[]>(timelinePath, { defaultValue: [] }) ?? [])
      : []

    // 任务分类
    const category = categorizeTask(taskJson.title || '', taskJson.description)

    // 读取节点名称序列
    let nodeNames: string[] | undefined
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

    stats.push({
      taskId: folder,
      createdAt,
      summary: statsData.summary,
      nodes: statsData.nodes || [],
      timeline,
      category,
      nodeNames,
    })
  }

  // 按创建时间排序
  return stats.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/**
 * 按周期分组任务
 */
export function groupByPeriod(
  stats: TaskStats[],
  periodType: 'day' | 'week' | 'month'
): Map<string, TaskStats[]> {
  const groups = new Map<string, TaskStats[]>()

  for (const stat of stats) {
    let key: string
    const date = stat.createdAt

    switch (periodType) {
      case 'day':
        key = date.toISOString().slice(0, 10)
        break
      case 'week': {
        const startOfWeek = new Date(date)
        startOfWeek.setDate(date.getDate() - date.getDay())
        key = startOfWeek.toISOString().slice(0, 10)
        break
      }
      case 'month':
        key = date.toISOString().slice(0, 7)
        break
    }

    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(stat)
  }

  return groups
}
