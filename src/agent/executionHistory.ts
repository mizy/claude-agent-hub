/**
 * 执行历史学习
 * 从历史任务执行结果中学习，提升 Workflow 生成质量
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { TASKS_DIR } from '../store/paths.js'
import { getAllTaskSummaries, type TaskSummary } from '../store/TaskStore.js'
import { createLogger } from '../shared/logger.js'
import type { Workflow, WorkflowNode } from '../workflow/types.js'

const logger = createLogger('exec-history')

/**
 * 任务类型分类
 */
export type TaskCategory = 'git' | 'refactor' | 'feature' | 'fix' | 'docs' | 'test' | 'iteration' | 'other'

/**
 * 节点模式
 */
export interface NodePattern {
  /** 模式名称 */
  name: string
  /** 节点序列 */
  nodeSequence: string[]
  /** 出现次数 */
  occurrences: number
  /** 平均成功率 */
  successRate: number
}

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
  /** 任务类型 */
  category: TaskCategory
  /** 执行状态 */
  status: string
  /** 节点数量 */
  nodeCount: number
  /** 节点名称列表 */
  nodeNames?: string[]
  /** 失败节点 */
  failedNodes?: string[]
  /** 失败原因 */
  failureReasons?: string[]
  /** 执行时长（秒） */
  durationSec?: number
  /** 创建时间 */
  createdAt: string
}

/**
 * 学习建议
 */
export interface LearningInsights {
  /** 任务分类 */
  taskCategory: TaskCategory
  /** 相似任务的成功模式 */
  successPatterns: string[]
  /** 常见失败原因 */
  commonFailures: string[]
  /** 推荐的节点粒度 */
  recommendedNodeCount?: number
  /** 成功的节点模式 */
  successfulNodePatterns: NodePattern[]
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
 * 分类任务类型
 */
function categorizeTask(title: string, description?: string): TaskCategory {
  const text = `${title} ${description || ''}`.toLowerCase()

  // Git 相关
  if (/commit|push|pull|merge|提交|推送|合并/.test(text)) {
    return 'git'
  }

  // 迭代/进化
  if (/迭代|进化|iteration|evolution|cycle|周期/.test(text)) {
    return 'iteration'
  }

  // 重构
  if (/refactor|重构|优化|整理|reorganize/.test(text)) {
    return 'refactor'
  }

  // 修复
  if (/fix|bug|修复|修正|repair/.test(text)) {
    return 'fix'
  }

  // 测试
  if (/test|测试|spec|unittest/.test(text)) {
    return 'test'
  }

  // 文档
  if (/doc|文档|readme|changelog/.test(text)) {
    return 'docs'
  }

  // 功能开发
  if (/add|feature|implement|新增|添加|实现|功能/.test(text)) {
    return 'feature'
  }

  return 'other'
}

/**
 * 构建历史条目
 */
async function buildHistoryEntry(summary: TaskSummary): Promise<TaskHistoryEntry | null> {
  const taskDir = join(TASKS_DIR, summary.id)

  // 读取 workflow
  const workflowPath = join(taskDir, 'workflow.json')
  let nodeCount = 0
  let nodeNames: string[] = []
  if (existsSync(workflowPath)) {
    try {
      const workflow: Workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'))
      const taskNodes = workflow.nodes?.filter((n: WorkflowNode) => n.type === 'task') || []
      nodeCount = workflow.nodes?.length || 0
      nodeNames = taskNodes.map((n: WorkflowNode) => n.name)
    } catch {
      // ignore
    }
  }

  // 读取 instance 获取失败节点
  const instancePath = join(taskDir, 'instance.json')
  const failedNodes: string[] = []
  const failureReasons: string[] = []
  let durationSec: number | undefined

  if (existsSync(instancePath)) {
    try {
      const instance = JSON.parse(readFileSync(instancePath, 'utf-8'))

      // 获取失败节点和原因
      if (instance.nodeStates) {
        const entries = Object.entries(instance.nodeStates) as [string, { status?: string; error?: string }][]
        for (const [nodeId, state] of entries) {
          if (state.status === 'failed') {
            failedNodes.push(nodeId)
            if (state.error) {
              failureReasons.push(`${nodeId}: ${state.error}`)
            }
          }
        }
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

  // 读取 task.json 获取描述
  const taskPath = join(taskDir, 'task.json')
  let description: string | undefined
  if (existsSync(taskPath)) {
    try {
      const task = JSON.parse(readFileSync(taskPath, 'utf-8'))
      description = task.description
    } catch {
      // ignore
    }
  }

  const category = categorizeTask(summary.title, description)

  return {
    taskId: summary.id,
    title: summary.title,
    description,
    category,
    status: summary.status,
    nodeCount,
    nodeNames: nodeNames.length > 0 ? nodeNames : undefined,
    failedNodes: failedNodes.length > 0 ? failedNodes : undefined,
    failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
    durationSec,
    createdAt: summary.createdAt,
  }
}

/**
 * 提取成功的节点模式
 */
function extractSuccessfulNodePatterns(tasks: TaskHistoryEntry[], category: TaskCategory): NodePattern[] {
  // 过滤同类型的成功任务
  const sameCategorySuccessTasks = tasks.filter(
    t => t.status === 'completed' && t.category === category && t.nodeNames && t.nodeNames.length > 0
  )

  if (sameCategorySuccessTasks.length === 0) {
    return []
  }

  // 统计节点名称模式
  const patternMap = new Map<string, { count: number; successCount: number }>()

  for (const task of sameCategorySuccessTasks) {
    if (!task.nodeNames) continue
    // 使用节点序列作为模式 key
    const patternKey = task.nodeNames.join(' → ')
    const existing = patternMap.get(patternKey) || { count: 0, successCount: 0 }
    existing.count++
    if (task.status === 'completed') {
      existing.successCount++
    }
    patternMap.set(patternKey, existing)
  }

  // 转换为 NodePattern 数组
  const patterns: NodePattern[] = []
  for (const [key, stats] of patternMap) {
    const nodeSequence = key.split(' → ')
    patterns.push({
      name: `${category}-pattern-${patterns.length + 1}`,
      nodeSequence,
      occurrences: stats.count,
      successRate: stats.successCount / stats.count,
    })
  }

  // 按出现次数排序
  return patterns.sort((a, b) => b.occurrences - a.occurrences).slice(0, 3)
}

/**
 * 按类型计算推荐节点数
 */
function getRecommendedNodeCountByCategory(tasks: TaskHistoryEntry[], category: TaskCategory): number | undefined {
  const sameCategorySuccessTasks = tasks.filter(
    t => t.status === 'completed' && t.category === category && t.nodeCount > 0
  )

  if (sameCategorySuccessTasks.length === 0) {
    // 回退到全局成功任务
    const allSuccessTasks = tasks.filter(t => t.status === 'completed' && t.nodeCount > 0)
    if (allSuccessTasks.length === 0) return undefined
    const avg = allSuccessTasks.reduce((sum, t) => sum + t.nodeCount, 0) / allSuccessTasks.length
    return Math.round(avg)
  }

  const avg = sameCategorySuccessTasks.reduce((sum, t) => sum + t.nodeCount, 0) / sameCategorySuccessTasks.length
  return Math.round(avg)
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

  // 识别当前任务类型
  const taskCategory = categorizeTask(taskDescription, taskDescription)
  logger.debug(`任务类型: ${taskCategory}`)

  const insights: LearningInsights = {
    taskCategory,
    successPatterns: [],
    commonFailures: [],
    successfulNodePatterns: [],
    relatedTasks: [],
  }

  // 简单的相似度匹配（基于关键词）
  const keywords = extractKeywords(taskDescription)
  logger.debug(`任务关键词: ${keywords.join(', ')}`)

  // 查找相关任务（同类型优先）
  const sameCategoryTasks = history.filter(t => t.category === taskCategory)
  for (const entry of sameCategoryTasks) {
    insights.relatedTasks.push(entry)
  }

  // 补充关键词匹配的任务
  for (const entry of history) {
    if (insights.relatedTasks.find(t => t.taskId === entry.taskId)) continue
    const entryKeywords = extractKeywords(`${entry.title} ${entry.description || ''}`)
    const overlap = keywords.filter(k => entryKeywords.includes(k))
    if (overlap.length > 0) {
      insights.relatedTasks.push(entry)
    }
  }

  // 限制相关任务数量
  insights.relatedTasks = insights.relatedTasks.slice(0, 10)

  // 分析成功模式
  const successTasks = history.filter(t => t.status === 'completed')
  const failedTasks = history.filter(t => t.status === 'failed')

  // 按类型计算推荐节点数
  insights.recommendedNodeCount = getRecommendedNodeCountByCategory(history, taskCategory)

  // 提取成功模式
  if (successTasks.length > 0) {
    insights.successPatterns.push(
      `历史任务成功率: ${Math.round((successTasks.length / history.length) * 100)}%`
    )

    // 同类型任务统计
    const sameCategorySuccess = successTasks.filter(t => t.category === taskCategory)
    if (sameCategorySuccess.length > 0) {
      insights.successPatterns.push(
        `同类型(${taskCategory})任务成功数: ${sameCategorySuccess.length} 个`
      )
    }

    if (insights.recommendedNodeCount) {
      insights.successPatterns.push(
        `${taskCategory} 类型任务推荐节点数: ${insights.recommendedNodeCount} 个`
      )
    }
  }

  // 提取成功的节点模式
  insights.successfulNodePatterns = extractSuccessfulNodePatterns(history, taskCategory)
  const topPattern = insights.successfulNodePatterns[0]
  if (topPattern) {
    insights.successPatterns.push(
      `推荐节点流程: ${topPattern.nodeSequence.join(' → ')}`
    )
  }

  // 提取失败教训
  if (failedTasks.length > 0) {
    // 统计失败节点类型
    const failureTypes = new Map<string, number>()
    const failureMessages: string[] = []

    for (const task of failedTasks) {
      if (task.failedNodes) {
        for (const node of task.failedNodes) {
          const type = node.split('-')[0] || 'unknown'
          failureTypes.set(type, (failureTypes.get(type) || 0) + 1)
        }
      }
      // 收集失败原因
      if (task.failureReasons) {
        failureMessages.push(...task.failureReasons)
      }
    }

    if (failureTypes.size > 0) {
      const sorted = [...failureTypes.entries()].sort((a, b) => b[1] - a[1])
      for (const [type, count] of sorted.slice(0, 3)) {
        insights.commonFailures.push(`${type} 类型节点失败 ${count} 次`)
      }
    }

    // 添加具体失败原因（去重）
    const uniqueReasons = [...new Set(failureMessages)].slice(0, 3)
    for (const reason of uniqueReasons) {
      insights.commonFailures.push(`历史失败: ${reason}`)
    }
  }

  // 添加类型特定的建议
  addCategorySpecificAdvice(insights, taskCategory)

  logger.info(`学习完成: ${insights.relatedTasks.length} 个相关任务, ${insights.successPatterns.length} 个成功模式`)

  return insights
}

/**
 * 添加类型特定的建议
 */
function addCategorySpecificAdvice(insights: LearningInsights, category: TaskCategory): void {
  switch (category) {
    case 'git':
      insights.successPatterns.push('Git 操作建议: 合并 check/review/stage/commit 为 2-3 个节点')
      break
    case 'iteration':
      insights.successPatterns.push('迭代任务建议: 将迭代与文档更新合并为单个节点')
      break
    case 'refactor':
      insights.successPatterns.push('重构任务建议: 在代码修改后添加 typecheck 验证节点')
      break
    case 'feature':
      insights.successPatterns.push('功能开发建议: 先分析现有代码，再实现，最后验证')
      break
    case 'fix':
      insights.successPatterns.push('修复任务建议: 先定位问题，验证修复，再提交')
      break
    default:
      break
  }
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
  parts.push(`\n任务类型识别为: **${insights.taskCategory}**`)

  // 成功模式
  if (insights.successPatterns.length > 0) {
    parts.push(`\n### 成功经验`)
    for (const pattern of insights.successPatterns) {
      parts.push(`- ${pattern}`)
    }
  }

  // 成功的节点模式
  if (insights.successfulNodePatterns.length > 0) {
    parts.push(`\n### 成功的节点模式`)
    for (const pattern of insights.successfulNodePatterns.slice(0, 2)) {
      parts.push(`- ${pattern.nodeSequence.join(' → ')} (成功率: ${Math.round(pattern.successRate * 100)}%)`)
    }
  }

  // 失败教训
  if (insights.commonFailures.length > 0) {
    parts.push(`\n### 需要规避的失败模式`)
    for (const failure of insights.commonFailures) {
      parts.push(`- ${failure}`)
    }
  }

  // 相关任务
  if (insights.relatedTasks.length > 0) {
    parts.push(`\n### 相关历史任务`)
    for (const task of insights.relatedTasks.slice(0, 5)) {
      const status = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳'
      const categoryTag = task.category !== insights.taskCategory ? ` [${task.category}]` : ''
      parts.push(`- ${status} ${task.title}${categoryTag} (${task.nodeCount} 节点)`)
    }
  }

  // 推荐
  parts.push(`\n### 节点设计建议`)
  if (insights.recommendedNodeCount) {
    parts.push(`- **${insights.taskCategory}** 类型任务推荐 ${insights.recommendedNodeCount} 个左右的节点`)
  }

  // 类型特定提示
  switch (insights.taskCategory) {
    case 'git':
      parts.push(`- Git 操作应合并为 2-3 个节点（分析、提交、验证）`)
      break
    case 'iteration':
      parts.push(`- 迭代任务每个周期用 1-2 个节点，包含代码修改和文档更新`)
      break
    case 'refactor':
      parts.push(`- 重构后必须添加 typecheck/lint 验证节点`)
      break
    case 'feature':
      parts.push(`- 功能开发流程：分析 → 实现 → 测试/验证`)
      break
    case 'fix':
      parts.push(`- 修复流程：定位 → 修复 → 验证 → 提交`)
      break
    default:
      break
  }

  return parts.join('\n')
}
