/**
 * Task mutation commands — run/stop/pause/resume/msg/snapshot
 */

import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
import { truncateText } from '../../shared/truncateText.js'
import {
  createAndRunTask,
  stopTask,
  resumeOrphanedTask as resumeTask,
  pauseTask,
  getTaskInstance,
  getTaskWorkflow,
} from '../../task/index.js'
import { addTaskMessage, getUnconsumedMessages } from '../../store/TaskMessageStore.js'
import { getWorkflowProgress } from '../../workflow/index.js'
import { formatDuration } from '../../shared/formatTime.js'
import {
  buildCard,
  mdElement,
  hrElement,
  actionElement,
  button,
  taskLogsAction,
} from '../buildLarkCard.js'
import { statusEmoji } from './constants.js'
import { withResolvedTask } from './resolveTaskId.js'
import type { CommandResult } from './types.js'

const logger = createLogger('command-handler')

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

export async function handleStop(taskIdPrefix: string): Promise<CommandResult> {
  return withResolvedTask(taskIdPrefix, '用法: /stop <taskId前缀>', async task => {
    const stopResult = stopTask(task.id)
    if (stopResult.success) {
      logger.info(`→ task stopped: ${task.id.slice(0, 20)}`)
      return { text: `🛑 已停止任务: \`${task.id.slice(0, 20)}\`` }
    } else {
      logger.warn(`→ stop failed: ${stopResult.error}`)
      return { text: `❌ 停止失败: ${stopResult.error}` }
    }
  })
}

export async function handleResume(taskIdPrefix: string): Promise<CommandResult> {
  return withResolvedTask(taskIdPrefix, '用法: /resume <taskId前缀>', async task => {
    const pid = resumeTask(task.id)
    if (pid) {
      logger.info(`→ task resumed: ${task.id.slice(0, 20)} pid=${pid}`)
      return { text: `▶️ 已恢复任务: \`${task.id.slice(0, 20)}\`\nPID: ${pid}` }
    } else {
      logger.warn(`→ resume skipped: ${task.id.slice(0, 20)} (running or completed)`)
      return { text: `⚠️ 无法恢复任务（可能仍在运行或已完成）` }
    }
  })
}

export async function handleMsg(args: string): Promise<CommandResult> {
  const spaceIdx = args.indexOf(' ')
  if (!args.trim() || spaceIdx === -1) {
    return { text: '用法: /msg <taskId前缀> <消息内容>' }
  }

  const taskIdPrefix = args.slice(0, spaceIdx).trim()
  const message = args.slice(spaceIdx + 1).trim()
  if (!message) {
    return { text: '用法: /msg <taskId前缀> <消息内容>' }
  }

  return withResolvedTask(taskIdPrefix, '用法: /msg <taskId前缀> <消息内容>', async task => {
    const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])
    if (terminalStatuses.has(task.status)) {
      return { text: `⚠️ 任务已 ${task.status}，无法发送消息` }
    }

    const msg = addTaskMessage(task.id, message, 'lark')
    logger.debug(`→ msg sent to ${task.id.slice(0, 20)}: ${truncateText(message, 40)}`)
    return { text: `✅ 消息已发送到任务 \`${task.id.slice(0, 20)}\`\nMessage ID: ${msg.id.slice(0, 8)}` }
  })
}

export async function handlePause(args: string): Promise<CommandResult> {
  const parts = args.trim().split(/\s+/)
  const taskIdPrefix = parts[0] || ''
  const reason = parts.slice(1).join(' ') || undefined

  return withResolvedTask(taskIdPrefix, '用法: /pause <taskId前缀> [原因]', async task => {
    const pauseResult = pauseTask(task.id, reason)
    if (pauseResult.success) {
      logger.info(`→ task paused: ${task.id.slice(0, 20)}`)
      return { text: `⏸️ 已暂停任务: \`${task.id.slice(0, 20)}\`${reason ? `\n原因: ${reason}` : ''}\n\n使用 /resume 恢复` }
    } else {
      return { text: `⚠️ 暂停失败: ${pauseResult.error}` }
    }
  })
}

export async function handleSnapshot(taskIdPrefix: string): Promise<CommandResult> {
  return withResolvedTask(taskIdPrefix, '用法: /snapshot <taskId前缀>', async task => {
    const instance = getTaskInstance(task.id)
    const workflow = getTaskWorkflow(task.id)

    if (!instance || !workflow) {
      return { text: `⚠️ 任务 \`${task.id.slice(0, 20)}\` 暂无工作流数据` }
    }

    const progress = getWorkflowProgress(instance, workflow)
    const messages = getUnconsumedMessages(task.id)
    const isPaused = task.status === 'paused' || instance.status === 'paused'

    const lines: string[] = [
      `📸 **任务快照**`,
      `**${task.title}**`,
      '',
      `状态: ${statusEmoji(task.status)} ${task.status}`,
      `进度: ${progress.completed}/${progress.total} (${progress.percentage}%)`,
    ]

    if (isPaused) {
      lines.push(`⏸️ **已暂停**${instance.pauseReason ? ` (${instance.pauseReason})` : ''}`)
    }

    if (messages.length > 0) {
      lines.push(`💬 待处理消息: ${messages.length} 条`)
    }

    // Node statuses
    lines.push('', '**节点状态:**')
    for (const node of workflow.nodes) {
      if (node.type === 'start' || node.type === 'end') continue
      const state = instance.nodeStates[node.id]
      const status = state?.status || 'pending'
      const dur = state?.durationMs ? ` (${formatDuration(state.durationMs)})` : ''
      lines.push(`${statusEmoji(status)} ${node.name}${dur}`)
    }

    // Build Lark card
    const elements = [
      mdElement(`**${task.title}**`),
      mdElement(lines.slice(3).join('\n')),
    ]
    elements.push(hrElement())
    elements.push(
      actionElement([
        button('📜 日志', 'default', taskLogsAction(task.id)),
        ...(isPaused ? [button('▶️ 继续', 'primary', { action: 'task_resume' as const, taskId: task.id })] : []),
        ...(!isPaused && task.status === 'developing' ? [button('⏸️ 暂停', 'default', { action: 'task_pause' as const, taskId: task.id })] : []),
      ])
    )

    return {
      text: lines.join('\n'),
      larkCard: buildCard('📸 任务快照', 'blue', elements),
    }
  })
}
