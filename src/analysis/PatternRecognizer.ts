/**
 * 模式识别器
 * 从历史任务中识别成功的节点模式
 */

import type { TaskCategory } from './TaskClassifier.js'
import type { TaskHistoryEntry, NodePattern, LearningInsights } from './historyTypes.js'

/**
 * 提取成功的节点模式
 */
export function extractSuccessfulNodePatterns(
  tasks: TaskHistoryEntry[],
  category: TaskCategory
): NodePattern[] {
  // 过滤同类型的成功任务
  const sameCategorySuccessTasks = tasks.filter(
    t =>
      t.status === 'completed' && t.category === category && t.nodeNames && t.nodeNames.length > 0
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
export function getRecommendedNodeCountByCategory(
  tasks: TaskHistoryEntry[],
  category: TaskCategory
): number | undefined {
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

  const avg =
    sameCategorySuccessTasks.reduce((sum, t) => sum + t.nodeCount, 0) /
    sameCategorySuccessTasks.length
  return Math.round(avg)
}

/**
 * 添加类型特定的建议
 */
export function addCategorySpecificAdvice(
  insights: LearningInsights,
  category: TaskCategory
): void {
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
