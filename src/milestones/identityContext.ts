/**
 * Generate identity context text from milestones and statistics
 *
 * Produces a ~500 char self-awareness text combining milestone history
 * with runtime statistics.
 */

import { getStatsOverview } from '../statistics/index.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('milestones:identity')

/** @entry Generate identity context text for self-awareness */
export function getIdentityContext(): string {
  try {
    const stats = getStatsOverview()

    const birthDate = stats.growth.birthDate
      ? new Date(stats.growth.birthDate).toLocaleDateString('zh-CN')
      : '未知'
    const ageDays = stats.growth.ageDays || 0
    const totalTasks = stats.task.total
    const totalMessages = stats.chat.totalMessages

    const milestones = stats.projectMilestones
    if (!milestones || milestones.length === 0) {
      return buildSimpleContext(birthDate, ageDays, totalTasks, totalMessages)
    }
    const totalMilestones = milestones.length

    // Get recent 3 milestones summary
    const recent = milestones.slice(-3)
    const recentSummary = recent
      .map(m => `${m.version}「${m.title}」`)
      .join('、')

    // Build full context
    const parts = [
      `我诞生于 ${birthDate}，已运行 ${ageDays} 天。`,
      `经历了 ${totalMilestones} 个里程碑：${recentSummary}。`,
      `累计处理 ${totalTasks} 个任务、${totalMessages} 条消息。`,
    ]

    // Add task success rate if meaningful
    if (totalTasks > 0 && stats.task.successRate > 0) {
      parts.push(`任务成功率 ${Math.round(stats.task.successRate * 100)}%。`)
    }

    return parts.join('')
  } catch (error) {
    logger.warn(`Failed to generate identity context: ${getErrorMessage(error)}`)
    return '我是 Claude Agent Hub，一个自举式 AI 任务系统。'
  }
}

/** Build simplified context when milestones are unavailable */
function buildSimpleContext(
  birthDate: string,
  ageDays: number,
  totalTasks: number,
  totalMessages: number,
): string {
  return [
    `我诞生于 ${birthDate}，已运行 ${ageDays} 天。`,
    `累计处理 ${totalTasks} 个任务、${totalMessages} 条消息。`,
    '里程碑数据尚未生成。',
  ].join('')
}
