/**
 * Query commands — list/get/logs (read-only task queries)
 */

import { readFileSync } from 'fs'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { truncateText } from '../../shared/truncateText.js'
import {
  getAllTasks,
  getLogPath,
  getTaskWorkflow,
  getTaskInstance,
} from '../../task/index.js'
import { formatDuration } from '../../shared/formatTime.js'
import { parseTaskStatus } from '../../types/task.js'
import {
  buildTaskListCard,
  buildTaskDetailCard,
  buildTaskLogsCard,
} from '../buildLarkCard.js'
import type { TaskListItem } from '../buildLarkCard.js'
import { statusEmoji } from './constants.js'
import { withResolvedTask } from './resolveTaskId.js'
import type { Task } from '../../types/task.js'
import type { CommandResult } from './types.js'

const logger = createLogger('command-handler')

const ACTIVE_STATUSES = new Set(['pending', 'planning', 'developing', 'reviewing'])
const PAGE_SIZE = 5

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return '刚刚'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d前`
  const months = Math.floor(days / 30)
  return `${months}mo前`
}

function buildTaskListItems(tasks: Task[]): TaskListItem[] {
  return tasks.map(t => {
    const prefix = t.source === 'selfdrive' ? '[自驱] ' : ''
    return {
      id: t.id,
      shortId: t.id.replace(/^task-/, '').slice(0, 4),
      title: truncateText(`${prefix}${t.title}`, 40),
      status: t.status,
      priority: t.priority,
      relativeTime: formatRelativeTime(t.updatedAt || t.createdAt),
    }
  })
}

function formatTaskLine(item: TaskListItem): string {
  return `${statusEmoji(item.status)} ${item.title}  ${item.priority}  ${item.relativeTime}`
}

export async function handleList(statusFilter?: string, page = 1): Promise<CommandResult> {
  try {
    let tasks = getAllTasks()

    if (statusFilter) {
      const filter = parseTaskStatus(statusFilter.toLowerCase())
      if (filter) {
        tasks = tasks.filter(t => t.status === filter)
      }
    }

    if (tasks.length === 0) {
      return { text: statusFilter ? `没有 ${statusFilter} 状态的任务` : '暂无任务' }
    }

    // Split into active and completed groups
    const activeTasks = tasks.filter(t => ACTIVE_STATUSES.has(t.status))
    const completedTasks = tasks.filter(t => !ACTIVE_STATUSES.has(t.status))

    // Paginate: each page shows up to PAGE_SIZE total
    const totalPages = Math.ceil(tasks.length / PAGE_SIZE)
    const safePage = Math.max(1, Math.min(page, totalPages))
    const startIdx = (safePage - 1) * PAGE_SIZE

    // Simple pagination: slice from all tasks then re-split
    const pageTasks = tasks.slice(startIdx, startIdx + PAGE_SIZE)
    const pageActive = pageTasks.filter(t => ACTIVE_STATUSES.has(t.status))
    const pageCompleted = pageTasks.filter(t => !ACTIVE_STATUSES.has(t.status))

    const activeItems = buildTaskListItems(pageActive)
    const completedItems = buildTaskListItems(pageCompleted)

    // Build text for Telegram/plain fallback
    const lines: string[] = []
    if (activeItems.length > 0) {
      lines.push(`🔄 进行中 (${activeTasks.length})`)
      lines.push(...activeItems.map(formatTaskLine))
    }
    if (activeItems.length > 0 && completedItems.length > 0) {
      lines.push('')
    }
    if (completedItems.length > 0) {
      lines.push(`✅ 已完成 (${completedTasks.length})`)
      lines.push(...completedItems.map(formatTaskLine))
    }
    if (totalPages > 1) {
      lines.push('', `第 ${safePage}/${totalPages} 页`)
    }

    return {
      text: `📋 任务列表 (${tasks.length}):\n\n${lines.join('\n')}`,
      larkCard: buildTaskListCard(
        { active: activeItems, completed: completedItems },
        {
          total: tasks.length,
          activeCount: activeTasks.length,
          completedCount: completedTasks.length,
        },
        safePage,
        totalPages,
        statusFilter
      ),
    }
  } catch (error) {
    const msg = formatErrorMessage(error)
    return { text: `❌ 获取任务列表失败: ${msg}` }
  }
}

export async function handleLogs(taskIdPrefix: string): Promise<CommandResult> {
  return withResolvedTask(taskIdPrefix, '用法: /logs <taskId前缀>', async task => {
    const logPath = getLogPath(task.id)
    let content: string
    try {
      content = readFileSync(logPath, 'utf-8')
    } catch (e) {
      logger.debug(`Failed to read logs for ${task.id.slice(0, 20)}: ${getErrorMessage(e)}`)
      return { text: `暂无日志: ${task.id.slice(0, 20)}` }
    }

    const lines = content.trim().split('\n')
    const tail = lines.slice(-20).join('\n')
    const truncated = tail.length > 3500 ? '...\n' + tail.slice(-3500) : tail

    const cardTail = lines.slice(-50).join('\n')
    return {
      text: `📜 日志 \`${task.id.slice(0, 20)}\`:\n\n\`\`\`\n${truncated}\n\`\`\``,
      larkCard: buildTaskLogsCard(task.id, cardTail),
    }
  })
}

export async function handleGet(taskIdPrefix: string): Promise<CommandResult> {
  return withResolvedTask(taskIdPrefix, '用法: /get <taskId前缀>', async task => {
    const createdAt = new Date(task.createdAt)
    const lines = [
      `📌 ${task.title}`,
      '',
      `ID: \`${task.id}\``,
      `状态: ${statusEmoji(task.status)} ${task.status}`,
      `优先级: ${task.priority}`,
      `创建: ${createdAt.toLocaleString('zh-CN')}`,
    ]

    if (task.assignee) {
      lines.push(`指派: ${task.assignee}`)
    }

    if (task.output?.timing) {
      const { startedAt, completedAt } = task.output.timing
      if (startedAt && completedAt) {
        const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime()
        if (duration > 0) {
          lines.push(`耗时: ${formatDuration(duration)}`)
        }
      }
    }

    if (task.description && task.description !== task.title) {
      const desc =
        task.description.length > 200 ? task.description.slice(0, 197) + '...' : task.description
      lines.push('', `描述: ${desc}`)
    }

    const instance = getTaskInstance(task.id)
    const workflow = getTaskWorkflow(task.id)
    return { text: lines.join('\n'), larkCard: buildTaskDetailCard(task, instance, workflow) }
  })
}
