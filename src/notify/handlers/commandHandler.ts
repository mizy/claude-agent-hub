/**
 * 统一指令处理器 — 平台无关的任务管理指令业务逻辑
 *
 * 所有函数返回 CommandResult，不依赖任何 Telegram/飞书 API。
 * 平台适配层（telegramCommandHandler / larkCommandHandler）调用这些函数，
 * 再通过各自的 MessengerAdapter 发送结果。
 */

import { readFileSync } from 'fs'
import { createLogger } from '../../shared/logger.js'
import { getAllTasks } from '../../store/TaskStore.js'
import { getLogPath } from '../../store/TaskLogStore.js'
import { createAndRunTask } from '../../task/createAndRun.js'
import { stopTask } from '../../task/manageTaskLifecycle.js'
import { resumeTask } from '../../task/resumeTask.js'
import { formatDuration } from '../../shared/formatTime.js'
import { getWaitingHumanJobs } from '../../workflow/queue/WorkflowQueue.js'
import { parseTaskStatus } from '../../types/task.js'
import {
  buildTaskListCard,
  buildTaskDetailCard,
  buildStatusCard,
  buildHelpCard,
} from '../buildLarkCard.js'
import type { Task } from '../../types/task.js'
import type { CommandResult } from './types.js'

const logger = createLogger('command-handler')

// ── taskId prefix matching ──

function resolveTaskId(
  prefix: string
): { task: Task; error?: never } | { task?: never; error: string } {
  const tasks = getAllTasks()
  const matches = tasks.filter(t => t.id.startsWith(prefix) || t.id.includes(prefix))

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

// ── Status emoji ──

const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳',
  planning: '📋',
  developing: '🔨',
  reviewing: '👀',
  completed: '✅',
  failed: '❌',
  cancelled: '🚫',
}

function statusEmoji(status: string): string {
  return STATUS_EMOJI[status] || '❓'
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
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`/run failed: ${msg}`)
    return { text: `❌ 创建任务失败: ${msg}` }
  }
}

export async function handleList(statusFilter?: string): Promise<CommandResult> {
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

    const display = tasks.slice(0, 15)
    const lines = display.map(t => {
      const shortId = t.id.slice(0, 20)
      const title = t.title.length > 25 ? t.title.slice(0, 22) + '...' : t.title
      return `${statusEmoji(t.status)} \`${shortId}\` ${title}`
    })

    if (tasks.length > 15) {
      lines.push(`\n... 还有 ${tasks.length - 15} 个任务`)
    }

    return {
      text: `📋 任务列表 (${tasks.length}):\n\n${lines.join('\n')}`,
      larkCard: buildTaskListCard(
        display.map(t => ({ id: t.id, title: t.title, status: t.status })),
        tasks.length
      ),
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
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
    const msg = error instanceof Error ? error.message : String(error)
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
    const msg = error instanceof Error ? error.message : String(error)
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
    const msg = error instanceof Error ? error.message : String(error)
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

    return { text: lines.join('\n'), larkCard: buildTaskDetailCard(task) }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
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
