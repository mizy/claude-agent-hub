/**
 * Task completion notifications — Telegram + Lark
 * Failures only log, never throw.
 */

import { readFile } from 'fs/promises'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
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

const SUMMARY_MAX_CHARS = 800

/**
 * Parse result.md structurally instead of naive truncation.
 * Extracts Summary section fields + Node execution statuses + errors.
 */
async function readOutputSummary(taskId: string): Promise<string | null> {
  try {
    const content = await readFile(getResultFilePath(taskId), 'utf-8')
    if (!content.trim()) return null

    const parts: string[] = []

    // Extract Summary section (Status, Progress, Duration lines)
    const summaryMatch = content.match(/#+\s*Summary\s*\n([\s\S]*?)(?=\n#+\s|\n---|$)/i)
    if (summaryMatch) {
      const summaryLines = summaryMatch[1]!
        .split('\n')
        .filter(l => /^\s*[-*]?\s*(Status|Progress|Duration|Cost)\s*[:：]/i.test(l))
      if (summaryLines.length > 0) {
        parts.push(summaryLines.join('\n'))
      }
    }

    // Extract Node Execution results (lines like "✅ Node Name" or "❌ Node Name")
    const nodeSection = content.match(
      /#+\s*Node\s+Execut\w*\s*\n([\s\S]*?)(?=\n#+\s|\n---|$)/i
    )
    if (nodeSection) {
      const nodeLines = nodeSection[1]!
        .split('\n')
        .filter(l => /^\s*[-*]?\s*[✅❌🔵⏳⚠]/u.test(l))
        .slice(0, 10) // cap at 10 nodes
      if (nodeLines.length > 0) {
        parts.push(nodeLines.join('\n'))
      }
    }

    // Extract error info on failure
    const errorSection = content.match(
      /#+\s*(Workflow\s+)?Error\s*\n([\s\S]*?)(?=\n#+\s|\n--[-]+|$)/i
    )
    if (errorSection) {
      const errorText = errorSection[2]!.trim().slice(0, 200)
      if (errorText) {
        parts.push(`Error: ${errorText}`)
      }
    }

    if (parts.length === 0) {
      // Fallback: take first meaningful lines
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      const fallback = lines.slice(0, 8).join('\n')
      return fallback.length > SUMMARY_MAX_CHARS
        ? fallback.slice(0, SUMMARY_MAX_CHARS) + '...'
        : fallback || null
    }

    let summary = parts.join('\n\n')
    if (summary.length > SUMMARY_MAX_CHARS) {
      summary = summary.slice(0, SUMMARY_MAX_CHARS) + '...'
    }
    return summary
  } catch {
    return null
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
    const msg = formatErrorMessage(error)
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
