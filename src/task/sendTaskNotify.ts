/**
 * Task completion notifications — Telegram + Lark
 * Failures only log, never throw.
 */

import { createLogger } from '../shared/logger.js'
import { formatDuration } from '../shared/formatTime.js'
import { loadConfig } from '../config/loadConfig.js'
import { sendTelegramTextMessage } from '../notify/sendTelegramNotify.js'
import { getDefaultChatId as getDefaultTelegramChatId } from '../notify/telegramClient.js'
import { sendLarkCardViaApi } from '../notify/sendLarkNotify.js'
import { getDefaultLarkChatId } from '../notify/larkWsClient.js'
import { buildTaskCompletedCard, buildTaskFailedCard } from '../notify/buildLarkCard.js'
import type { Task } from '../types/task.js'

const logger = createLogger('task-notify')

/**
 * Send task completion/failure notifications to all configured channels.
 */
export async function sendTaskCompletionNotify(
  task: Task,
  success: boolean,
  info: { durationMs: number; error?: string }
): Promise<void> {
  const config = await loadConfig()
  const duration = formatDuration(info.durationMs)
  const status = success ? 'completed' : 'failed'
  logger.info(`Task ${task.id} ${status}, sending notifications...`)

  // ── Telegram ──
  try {
    const tg = config.notify?.telegram
    if (tg?.botToken) {
      const status = success ? '✅ 完成' : '❌ 失败'
      const lines = [
        '📋 任务完成通知',
        '',
        `标题: ${task.title}`,
        `状态: ${status}`,
        `耗时: ${duration}`,
        `ID: ${task.id}`,
      ]
      if (!success && info.error) {
        lines.push(`错误: ${info.error.slice(0, 200)}`)
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
      const card = success
        ? buildTaskCompletedCard({ id: task.id, title: task.title }, duration)
        : buildTaskFailedCard(
            { id: task.id, title: task.title },
            duration,
            info.error || 'Unknown error'
          )
      await sendLarkCardViaApi(larkChatId, card)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.warn(`Lark 通知发送失败: ${msg}`)
  }
}
