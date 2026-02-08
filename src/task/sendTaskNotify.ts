/**
 * Task completion notifications — Telegram + Lark
 * Failures only log, never throw.
 */

import { readFile } from 'fs/promises'
import { createLogger } from '../shared/logger.js'
import { formatDuration } from '../shared/formatTime.js'
import { loadConfig } from '../config/loadConfig.js'
import { getResultFilePath } from '../store/paths.js'
import {
  sendTelegramTextMessage,
  getDefaultChatId as getDefaultTelegramChatId,
  sendLarkCardViaApi,
  getDefaultLarkChatId,
  buildTaskCompletedCard,
  buildTaskFailedCard,
} from '../notify/index.js'
import type { Task } from '../types/task.js'

const logger = createLogger('task-notify')

const SUMMARY_MAX_LINES = 5
const SUMMARY_MAX_CHARS = 300

async function readOutputSummary(taskId: string): Promise<string | null> {
  try {
    const content = await readFile(getResultFilePath(taskId), 'utf-8')
    if (!content.trim()) return null
    const lines = content.split('\n').slice(0, SUMMARY_MAX_LINES)
    let summary = lines.join('\n')
    if (summary.length > SUMMARY_MAX_CHARS) {
      summary = summary.slice(0, SUMMARY_MAX_CHARS) + '...'
    } else if (content.split('\n').length > SUMMARY_MAX_LINES) {
      summary += '\n...'
    }
    return summary
  } catch {
    return null
  }
}

export interface TaskNotifyInfo {
  durationMs: number
  error?: string
  workflowName?: string
  nodesCompleted?: number
  nodesFailed?: number
  totalNodes?: number
  totalCostUsd?: number
}

/**
 * Send task completion/failure notifications to all configured channels.
 */
export async function sendTaskCompletionNotify(
  task: Task,
  success: boolean,
  info: TaskNotifyInfo
): Promise<void> {
  const config = await loadConfig()
  const duration = formatDuration(info.durationMs)
  const status = success ? 'completed' : 'failed'
  logger.info(`Task ${task.id} ${status}, sending notifications...`)

  // Read output summary (best-effort, non-blocking)
  const outputSummary = success ? await readOutputSummary(task.id) : null

  // ── Telegram ──
  try {
    const tg = config.notify?.telegram
    if (tg?.botToken) {
      const statusText = success ? '✅ 完成' : '❌ 失败'
      const lines = [
        `📋 任务${success ? '完成' : '失败'}通知`,
        '',
        `标题: ${task.title}`,
        `状态: ${statusText}`,
        `耗时: ${duration}`,
      ]
      if (info.workflowName) {
        lines.push(`工作流: ${info.workflowName}`)
      }
      if (info.totalNodes != null) {
        lines.push(
          `节点: ${info.nodesCompleted ?? 0}/${info.totalNodes} 完成${info.nodesFailed ? `, ${info.nodesFailed} 失败` : ''}`
        )
      }
      if (info.totalCostUsd != null && info.totalCostUsd > 0) {
        lines.push(`费用: $${info.totalCostUsd.toFixed(4)}`)
      }
      lines.push(`ID: ${task.id}`)
      if (!success && info.error) {
        lines.push(``, `错误: ${info.error.slice(0, 200)}`)
      }
      if (outputSummary) {
        lines.push(``, `📝 输出摘要:`, outputSummary)
      }
      const tgChatId = tg.chatId || getDefaultTelegramChatId()
      if (tgChatId) {
        await sendTelegramTextMessage(lines.join('\n'), tgChatId)
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.warn(`Telegram 通知发送失败: ${msg}`)
  }

  // ── Lark ──
  try {
    const larkChatId = config.notify?.lark?.chatId || getDefaultLarkChatId()
    if (larkChatId) {
      const cardInfo = {
        id: task.id,
        title: task.title,
        workflowName: info.workflowName,
        nodesCompleted: info.nodesCompleted,
        nodesFailed: info.nodesFailed,
        totalNodes: info.totalNodes,
        totalCostUsd: info.totalCostUsd,
        outputSummary: outputSummary ?? undefined,
      }
      const card = success
        ? buildTaskCompletedCard(cardInfo, duration)
        : buildTaskFailedCard(cardInfo, duration, info.error || 'Unknown error')
      await sendLarkCardViaApi(larkChatId, card)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.warn(`Lark 通知发送失败: ${msg}`)
  }
}
