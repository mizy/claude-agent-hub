/**
 * 执行历史学习
 * 从历史任务执行结果中学习，提升 Workflow 生成质量
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { TASKS_DIR } from '../store/paths.js'
import { getAllTaskSummaries, type TaskSummary } from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'
import type { Workflow } from '../workflow/types.js'

const logger = createLogger('exec-history')

/**
 * 历史任务摘要
 */
export interface TaskHistoryEntry {
  /** 任务 ID */
  taskId: string
  /** 任务标题 */
  title: string
  /** 任务描述 */
  description?: string
  /** 执行状态 */
  status: string
  /** 节点数量 */
  nodeCount: number
  /** 失败节点 */
  failedNodes?: string[]
  /** 执行时长（秒） */
  durationSec?: number
  /** 创建时间 */
  createdAt: string
}

/**
 * 学习建议
 */
export interface LearningInsights {
  /** 相似任务的成功模式 */
  successPatterns: string[]
  /** 常见失败原因 */
  commonFailures: string[]
  /** 推荐的节点粒度 */
  recommendedNodeCount?: number
  /** 相关历史任务 */
  relatedTasks: TaskHistoryEntry[]
}

/**
 * 获取历史任务摘要
 */
export async function getTaskHistory(limit: number = 20): Promise<TaskHistoryEntry[]> {
  const summaries = getAllTaskSummaries()

  // 按创建时间倒序排列
  const sorted = summaries.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const entries: TaskHistoryEntry[] = []

  for (const summary of sorted.slice(0, limit)) {
    const entry = await buildHistoryEntry(summary)
    if (entry) {
      entries.push(entry)
    }
  }

  return entries
}

/**
 * 构建历史条目
 */
async function buildHistoryEntry(summary: TaskSummary): Promise<TaskHistoryEntry | null> {
  const taskDir = join(TASKS_DIR, summary.id)

  // 读取 workflow
  const workflowPath = join(taskDir, 'workflow.json')
  let nodeCount = 0
  if (existsSync(workflowPath)) {
    try {
      const workflow: Workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'))
      nodeCount = workflow.nodes?.length || 0
    } catch {
      // ignore
    }
  }

  // 读取 instance 获取失败节点
  const instancePath = join(taskDir, 'instance.json')
  let failedNodes: string[] = []
  let durationSec: number | undefined

  if (existsSync(instancePath)) {
    try {
      const instance = JSON.parse(readFileSync(instancePath, 'utf-8'))

      // 获取失败节点
      if (instance.nodeStates) {
        const entries = Object.entries(instance.nodeStates) as [string, { status?: string }][]
        failedNodes = entries
          .filter(([, state]) => state.status === 'failed')
          .map(([nodeId]) => nodeId)
      }

      // 计算执行时长
      if (instance.startedAt && instance.completedAt) {
        const start = new Date(instance.startedAt).getTime()
        const end = new Date(instance.completedAt).getTime()
        durationSec = Math.round((end - start) / 1000)
      }
    } catch {
      // ignore
    }
  }

  return {
    taskId: summary.id,
    title: summary.title,
    status: summary.status,
    nodeCount,
    failedNodes: failedNodes.length > 0 ? failedNodes : undefined,
    durationSec,
    createdAt: summary.createdAt,
  }
}

/**
 * 从历史中学习
 * 分析与当前任务相似的历史任务，提取成功模式和失败教训
 */
export async function learnFromHistory(
  taskDescription: string
): Promise<LearningInsights> {
  const history = await getTaskHistory(50)

  logger.debug(`分析 ${history.length} 条历史任务`)

  const insights: LearningInsights = {
    successPatterns: [],
    commonFailures: [],
    relatedTasks: [],
  }

  // 简单的相似度匹配（基于关键词）
  const keywords = extractKeywords(taskDescription)
  logger.debug(`任务关键词: ${keywords.join(', ')}`)

  // 查找相关任务
  for (const entry of history) {
    const entryKeywords = extractKeywords(`${entry.title} ${entry.description || ''}`)
    const overlap = keywords.filter(k => entryKeywords.includes(k))

    if (overlap.length > 0) {
      insights.relatedTasks.push(entry)
    }
  }

  // 分析成功模式
  const successTasks = history.filter(t => t.status === 'completed')
  const failedTasks = history.filter(t => t.status === 'failed')

  // 计算推荐节点数
  if (successTasks.length > 0) {
    const nodeCounts = successTasks.map(t => t.nodeCount).filter(c => c > 0)
    if (nodeCounts.length > 0) {
      const avg = nodeCounts.reduce((a, b) => a + b, 0) / nodeCounts.length
      insights.recommendedNodeCount = Math.round(avg)
    }
  }

  // 提取成功模式
  if (successTasks.length > 0) {
    insights.successPatterns.push(
      `历史任务成功率: ${Math.round((successTasks.length / history.length) * 100)}%`
    )

    if (insights.recommendedNodeCount) {
      insights.successPatterns.push(
        `成功任务平均节点数: ${insights.recommendedNodeCount} 个`
      )
    }
  }

  // 提取失败教训
  if (failedTasks.length > 0) {
    // 统计失败节点类型
    const failureReasons = new Map<string, number>()
    for (const task of failedTasks) {
      if (task.failedNodes) {
        for (const node of task.failedNodes) {
          // 简单提取节点类型
          const type = node.split('-')[0] || 'unknown'
          failureReasons.set(type, (failureReasons.get(type) || 0) + 1)
        }
      }
    }

    if (failureReasons.size > 0) {
      const sorted = [...failureReasons.entries()].sort((a, b) => b[1] - a[1])
      for (const [type, count] of sorted.slice(0, 3)) {
        insights.commonFailures.push(`${type} 类型节点失败 ${count} 次`)
      }
    }
  }

  logger.info(`学习完成: ${insights.relatedTasks.length} 个相关任务, ${insights.successPatterns.length} 个成功模式`)

  return insights
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  // 分词（简单实现）
  const words = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)

  // 去除常见停用词
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by',
    'for', 'with', 'about', 'to', 'from', 'in', 'on', 'of', 'as',
    '的', '是', '在', '和', '了', '有', '个', '这', '那', '我', '你', '他',
    '请', '把', '让', '给', '做', '用', '到', '会', '要', '能', '可以',
  ])

  return [...new Set(words.filter(w => !stopWords.has(w)))]
}

/**
 * 格式化学习洞察为 Prompt 片段
 */
export function formatInsightsForPrompt(insights: LearningInsights): string {
  const parts: string[] = []

  parts.push(`## 历史学习`)

  // 成功模式
  if (insights.successPatterns.length > 0) {
    parts.push(`\n### 成功经验`)
    for (const pattern of insights.successPatterns) {
      parts.push(`- ${pattern}`)
    }
  }

  // 失败教训
  if (insights.commonFailures.length > 0) {
    parts.push(`\n### 需要注意`)
    for (const failure of insights.commonFailures) {
      parts.push(`- ${failure}`)
    }
  }

  // 相关任务
  if (insights.relatedTasks.length > 0) {
    parts.push(`\n### 相关历史任务`)
    for (const task of insights.relatedTasks.slice(0, 5)) {
      const status = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳'
      parts.push(`- ${status} ${task.title} (${task.nodeCount} 节点)`)
    }
  }

  // 推荐
  if (insights.recommendedNodeCount) {
    parts.push(`\n### 建议`)
    parts.push(`- 参考历史成功任务，建议将任务拆分为 ${insights.recommendedNodeCount} 个左右的节点`)
  }

  return parts.join('\n')
}
