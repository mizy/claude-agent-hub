/**
 * Task notification sending — creation, completion/failure
 *
 * Bridges task lifecycle events to messaging channels (Lark/Telegram).
 * Lives in messaging/ to keep dependency direction: task → messaging (unidirectional).
 * Failures only log, never throw.
 */

import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { formatDuration } from '../shared/formatTime.js'
import { getNotifyConfig } from '../config/index.js'
import { readOutputSummary } from '../output/index.js'
import {
  sendTelegramTextMessage,
} from './sendTelegramNotify.js'
import {
  getDefaultChatId as getDefaultTelegramChatId,
} from './telegramClient.js'
import {
  sendLarkCardViaApi,
  sendLarkMessageViaApi,
} from './sendLarkNotify.js'
import {
  getDefaultLarkChatId,
} from './larkWsClient.js'
import {
  buildTaskCompletedCard,
  buildTaskFailedCard,
} from './buildLarkCard.js'
import type { Task } from '../types/task.js'

const logger = createLogger('task-notify')

/**
 * Send task creation notification immediately after task is created.
 * Non-blocking, failures are logged but don't interrupt task execution.
 */
export async function sendTaskCreatedNotification(task: Task): Promise<void> {
  try {
    const notifyConfig = await getNotifyConfig()
    const sourcePrefix = task.source === 'selfdrive' ? '[自驱] ' : ''
    const displayTitle = `${sourcePrefix}${task.title}`

    // ── Telegram ──
    const tg = notifyConfig?.telegram
    if (tg?.botToken) {
      const tgChatId = tg.chatId || getDefaultTelegramChatId()
      if (tgChatId) {
        const message = [
          `✅ 任务已创建`,
          ``,
          `ID: ${task.id}`,
          `标题: ${displayTitle}`,
          `状态: 🔵 ${task.status}`,
        ].join('\n')
        await sendTelegramTextMessage(message, tgChatId).catch(() => {
          // Ignore errors
        })
      }
    }

    // ── Lark ── Send via API client (text message type)
    const larkChatId = notifyConfig?.lark?.chatId || getDefaultLarkChatId()
    if (larkChatId) {
      const text = `✅ 任务已创建\nID: ${task.id}\n标题: ${displayTitle}\n状态: 🔵 ${task.status}`
      const sent = await sendLarkMessageViaApi(larkChatId, text)
      if (sent) {
        logger.info(`Sent task creation notification for ${task.id}`)
      }
    }
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.warn(`Failed to send task creation notification: ${msg}`)
  }
}

/** Node execution info for card rendering */
export interface NodeInfo {
  name: string
  status: string // 'done' | 'failed' | 'running' | 'skipped' | 'pending' | ...
  durationMs?: number
}

export interface TaskNotifyInfo {
  durationMs: number
  error?: string
  workflowName?: string
  nodesCompleted?: number
  nodesFailed?: number
  totalNodes?: number
  totalCostUsd?: number
  nodes?: NodeInfo[]
}

/**
 * Send task completion/failure notifications to all configured channels.
 */
export async function sendTaskCompletionNotify(
  task: Task,
  success: boolean,
  info: TaskNotifyInfo
): Promise<void> {
  const notifyConfig = await getNotifyConfig()
  const duration = formatDuration(info.durationMs)
  const status = success ? 'completed' : 'failed'
  const sourcePrefix = task.source === 'selfdrive' ? '[自驱] ' : ''
  const displayTitle = `${sourcePrefix}${task.title}`
  logger.info(`Task ${task.id} ${status}, sending notifications... (title: "${task.title}")`)

  // Read output summary (best-effort, non-blocking)
  const outputSummary = success ? await readOutputSummary(task.id) : null

  // ── Telegram ──
  try {
    const tg = notifyConfig?.telegram
    if (tg?.botToken) {
      const statusText = success ? '✅ 完成' : '❌ 失败'
      const lines = [
        `📋 任务${success ? '完成' : '失败'}通知`,
        '',
        `标题: ${displayTitle}`,
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
    const msg = formatErrorMessage(error)
    logger.warn(`Telegram 通知发送失败: ${msg}`)
  }

  // ── Lark ──
  try {
    const larkChatId = notifyConfig?.lark?.chatId || getDefaultLarkChatId()
    if (larkChatId) {
      const cardInfo = {
        id: task.id,
        title: displayTitle,
        workflowName: info.workflowName,
        nodesCompleted: info.nodesCompleted,
        nodesFailed: info.nodesFailed,
        totalNodes: info.totalNodes,
        totalCostUsd: info.totalCostUsd,
        outputSummary: outputSummary ?? undefined,
        nodes: info.nodes,
      }
      const card = success
        ? buildTaskCompletedCard(cardInfo, duration)
        : buildTaskFailedCard(cardInfo, duration, info.error || 'Unknown error')
      await sendLarkCardViaApi(larkChatId, card)
    }
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.warn(`Lark 通知发送失败: ${msg}`)
  }
}
