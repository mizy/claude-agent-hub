/**
 * 统一指令处理器 — 平台无关的任务管理指令业务逻辑
 *
 * 所有函数返回 CommandResult，不依赖任何 Telegram/飞书 API。
 * 平台适配层（telegramCommandHandler / larkCommandHandler）调用这些函数，
 * 再通过各自的 MessengerAdapter 发送结果。
 */

import { readFileSync } from 'fs'
import { spawn } from 'child_process'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import {
  getAllTasks,
  getLogPath,
  getTaskWorkflow,
  getTaskInstance,
  createAndRunTask,
  stopTask,
  resumeOrphanedTask as resumeTask,
} from '../../task/index.js'
import { formatDuration } from '../../shared/formatTime.js'
import { getWaitingHumanJobs } from '../../workflow/index.js'
import { parseTaskStatus } from '../../types/task.js'
import {
  buildTaskListCard,
  buildTaskDetailCard,
  buildStatusCard,
  buildHelpCard,
} from '../buildLarkCard.js'
import type { TaskListItem } from '../buildLarkCard.js'
import { statusEmoji } from './constants.js'
import type { Task } from '../../types/task.js'
import type { CommandResult } from './types.js'

const logger = createLogger('command-handler')

// ── taskId prefix matching ──

function resolveTaskId(
  prefix: string
): { task: Task; error?: never } | { task?: never; error: string } {
  const tasks = getAllTasks()
  const matches = tasks.filter(t => t.id.startsWith(prefix))

  if (matches.length === 0) {
    return { error: `未找到匹配的任务: ${prefix}` }
  }
  if (matches.length > 1) {
    const ids = matches
      .slice(0, 5)
      .map(t => `\`${t.id.slice(0, 20)}\``)
      .join('\n')
    return { error: `匹配到多个任务，请提供更长的前缀:\n${ids}` }
  }
  return { task: matches[0]! }
}

// ── Command handlers ──

/**
 * 统一入口：根据 command + args 分发到具体处理函数
 */
export async function handleCommand(command: string, args: string): Promise<CommandResult> {
  const argsPreview = args.length > 40 ? args.slice(0, 37) + '...' : args
  logger.info(`⚡ ${command}${argsPreview ? ' ' + argsPreview : ''}`)

  switch (command) {
    case '/run':
      return handleRun(args)
    case '/list':
      return handleList(args || undefined)
    case '/logs':
      return handleLogs(args)
    case '/stop':
      return handleStop(args)
    case '/resume':
      return handleResume(args)
    case '/get':
      return handleGet(args)
    case '/help':
      return handleHelp()
    case '/status':
      return handleStatus()
    case '/reload':
      return handleReload()
    default:
      return { text: `未知指令: ${command}\n输入 /help 查看可用指令` }
  }
}

export async function handleRun(description: string): Promise<CommandResult> {
  if (!description.trim()) {
    return { text: '用法: /run <任务描述>' }
  }

  try {
    const task = await createAndRunTask({ description: description.trim() })
    logger.info(`→ task created: ${task.id.slice(0, 20)}`)
    return {
      text: [
        `✅ 任务已创建`,
        `ID: \`${task.id}\``,
        `状态: ${statusEmoji(task.status)} ${task.status}`,
      ].join('\n'),
    }
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.error(`/run failed: ${msg}`)
    return { text: `❌ 创建任务失败: ${msg}` }
  }
}

const ACTIVE_STATUSES = new Set(['pending', 'planning', 'developing', 'reviewing'])
const PAGE_SIZE = 10

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
  return tasks.map(t => ({
    id: t.id,
    shortId: t.id.replace(/^task-/, '').slice(0, 4),
    title: t.title.length > 40 ? t.title.slice(0, 37) + '...' : t.title,
    status: t.status,
    priority: t.priority,
    relativeTime: formatRelativeTime(t.updatedAt || t.createdAt),
  }))
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

    // Paginate: each page shows up to GROUP_SIZE per group, PAGE_SIZE total
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
  if (!taskIdPrefix) {
    return { text: '用法: /logs <taskId前缀>' }
  }

  try {
    const result = resolveTaskId(taskIdPrefix)
    if (result.error) {
      return { text: result.error }
    }
    const task = result.task!

    const logPath = getLogPath(task.id)
    let content: string
    try {
      content = readFileSync(logPath, 'utf-8')
    } catch {
      return { text: `暂无日志: ${task.id.slice(0, 20)}` }
    }

    const lines = content.trim().split('\n')
    const tail = lines.slice(-20).join('\n')
    // 消息长度限制（兼容 Telegram 4096 / 飞书等平台）
    const truncated = tail.length > 3500 ? '...\n' + tail.slice(-3500) : tail

    return { text: `📜 日志 \`${task.id.slice(0, 20)}\`:\n\n\`\`\`\n${truncated}\n\`\`\`` }
  } catch (error) {
    const msg = formatErrorMessage(error)
    return { text: `❌ 获取日志失败: ${msg}` }
  }
}

export async function handleStop(taskIdPrefix: string): Promise<CommandResult> {
  if (!taskIdPrefix) {
    return { text: '用法: /stop <taskId前缀>' }
  }

  try {
    const result = resolveTaskId(taskIdPrefix)
    if (result.error) {
      return { text: result.error }
    }
    const task = result.task!

    const stopResult = stopTask(task.id)
    if (stopResult.success) {
      logger.info(`→ task stopped: ${task.id.slice(0, 20)}`)
      return { text: `🛑 已停止任务: \`${task.id.slice(0, 20)}\`` }
    } else {
      logger.warn(`→ stop failed: ${stopResult.error}`)
      return { text: `❌ 停止失败: ${stopResult.error}` }
    }
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.error(`/stop failed: ${msg}`)
    return { text: `❌ 停止任务失败: ${msg}` }
  }
}

export async function handleResume(taskIdPrefix: string): Promise<CommandResult> {
  if (!taskIdPrefix) {
    return { text: '用法: /resume <taskId前缀>' }
  }

  try {
    const result = resolveTaskId(taskIdPrefix)
    if (result.error) {
      return { text: result.error }
    }
    const task = result.task!

    const pid = resumeTask(task.id)
    if (pid) {
      logger.info(`→ task resumed: ${task.id.slice(0, 20)} pid=${pid}`)
      return { text: `▶️ 已恢复任务: \`${task.id.slice(0, 20)}\`\nPID: ${pid}` }
    } else {
      logger.warn(`→ resume skipped: ${task.id.slice(0, 20)} (running or completed)`)
      return { text: `⚠️ 无法恢复任务（可能仍在运行或已完成）` }
    }
  } catch (error) {
    const msg = formatErrorMessage(error)
    logger.error(`/resume failed: ${msg}`)
    return { text: `❌ 恢复任务失败: ${msg}` }
  }
}

export async function handleGet(taskIdPrefix: string): Promise<CommandResult> {
  if (!taskIdPrefix) {
    return { text: '用法: /get <taskId前缀>' }
  }

  try {
    const result = resolveTaskId(taskIdPrefix)
    if (result.error) {
      return { text: result.error }
    }
    const task = result.task!

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
  } catch (error) {
    const msg = formatErrorMessage(error)
    return { text: `❌ 获取任务详情失败: ${msg}` }
  }
}

export function handleHelp(): CommandResult {
  return {
    text: [
      '🤖 Claude Agent Hub 指令:',
      '',
      '📋 任务管理:',
      '/run <描述> - 创建并执行任务',
      '/list [status] - 查看任务列表',
      '/get <id> - 查看任务详情',
      '/logs <id> - 查看任务日志',
      '/stop <id> - 停止任务',
      '/resume <id> - 恢复任务',
      '',
      '✅ 审批:',
      '/approve [nodeId] - 批准节点',
      '/reject [原因] - 拒绝节点',
      '/status - 查看待审批节点',
      '',
      '💬 对话:',
      '/new - 开始新对话',
      '/chat - 查看对话状态',
      '/help - 显示此帮助',
      '',
      '🔧 系统:',
      '/reload - 重启守护进程（加载新代码）',
      '',
      '💡 直接发送文字即可与 AI 对话',
      '💡 taskId 支持前缀匹配',
    ].join('\n'),
    larkCard: buildHelpCard(),
  }
}

export function handleStatus(): CommandResult {
  const jobs = getWaitingHumanJobs()

  if (jobs.length === 0) {
    return { text: '没有待审批的节点', larkCard: buildStatusCard([]) }
  }

  const lines = ['待审批节点:\n']
  for (const job of jobs) {
    lines.push(`• \`${job.data.nodeId}\``)
  }
  lines.push('\n使用 /approve [nodeId] 或 /reject [原因] 操作')
  return {
    text: lines.join('\n'),
    larkCard: buildStatusCard(jobs.map(j => ({ nodeId: j.data.nodeId }))),
  }
}

export function handleReload(): CommandResult {
  // 通过 spawn 子进程执行 cah restart，避免阻塞当前消息回复
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1, 2), 'restart'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  logger.info('→ reload initiated via child process')
  return {
    text: [
      '🔄 正在重启守护进程...',
      '',
      '约 2 秒后生效，期间消息可能延迟',
      '',
      '💡 使用 /status 确认重启完成',
    ].join('\n'),
  }
}
