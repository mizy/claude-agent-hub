/**
 * 节点组合热力图分析器
 * 分析相邻节点的组合频率和成功率
 */

import type { TaskStats, NodeCombination } from './types.js'

/**
 * 分析节点组合热力图
 * 统计相邻节点的组合频率和成功率
 */
export function analyzeNodeHeatmap(stats: TaskStats[]): NodeCombination[] {
  const combinationMap = new Map<string, {
    count: number
    successCount: number
    totalDurationMs: number
  }>()

  for (const task of stats) {
    const nodeNames = task.nodeNames
    if (!nodeNames || nodeNames.length < 2) continue

    const isSuccess = task.summary.status === 'completed'

    // 统计相邻节点对
    for (let i = 0; i < nodeNames.length - 1; i++) {
      const combo = `${nodeNames[i]} → ${nodeNames[i + 1]}`
      const existing = combinationMap.get(combo) || { count: 0, successCount: 0, totalDurationMs: 0 }
      existing.count++
      if (isSuccess) existing.successCount++

      // 统计这两个节点的执行时间
      const node1 = task.nodes.find(n => n.nodeName === nodeNames[i])
      const node2 = task.nodes.find(n => n.nodeName === nodeNames[i + 1])
      if (node1?.durationMs) existing.totalDurationMs += node1.durationMs
      if (node2?.durationMs) existing.totalDurationMs += node2.durationMs

      combinationMap.set(combo, existing)
    }
  }

  return Array.from(combinationMap.entries())
    .map(([combination, data]) => ({
      combination,
      count: data.count,
      successRate: data.count > 0 ? Math.round((data.successCount / data.count) * 100) : 0,
      avgDurationMs: data.count > 0 ? Math.round(data.totalDurationMs / data.count / 2) : 0,
    }))
    .filter(c => c.count >= 2) // 至少出现 2 次
    .sort((a, b) => b.count - a.count)
    .slice(0, 15) // 取前 15 个最常见的组合
}
