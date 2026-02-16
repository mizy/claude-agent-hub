/**
 * Task lifecycle cards — completed, failed, detail, logs, list
 */

import { statusEmoji } from '../handlers/constants.js'
import { formatDuration } from '../../shared/formatTime.js'
import type { WorkflowInstance, Workflow, WorkflowNode } from '../../workflow/types.js'
import {
  buildCard,
  mdElement,
  hrElement,
  noteElement,
  actionElement,
  button,
  taskDetailAction,
  taskLogsAction,
  taskStopAction,
  taskRetryAction,
  taskPauseAction,
  taskResumeAction,
  taskMsgAction,
  taskViewResultAction,
  listPageAction,
} from './cardElements.js'
import type { LarkCard, LarkCardElement, LarkCardButton } from './cardElements.js'

// ── Shared types ──

export interface TaskNodeInfo {
  name: string
  status: string
  durationMs?: number
}

export interface TaskCardInfo {
  id: string
  title: string
  workflowName?: string
  nodesCompleted?: number
  nodesFailed?: number
  totalNodes?: number
  totalCostUsd?: number
  outputSummary?: string
  nodes?: TaskNodeInfo[]
}

export interface TaskListItem {
  id: string
  shortId: string
  title: string
  status: string
  priority: string
  relativeTime: string
}

export interface TaskDetailInput {
  id: string
  title: string
  status: string
  priority: string
  createdAt: string
  assignee?: string
  description?: string
  output?: { timing?: { startedAt?: string; completedAt?: string } }
}

// ── Internal helpers ──

const NODE_STATUS_EMOJI: Record<string, string> = {
  pending: '⏳',
  ready: '🔵',
  running: '🔄',
  waiting: '⏸️',
  done: '✅',
  failed: '❌',
  skipped: '⏭️',
}

function nodeStatusEmoji(status: string): string {
  return NODE_STATUS_EMOJI[status] || '❓'
}

/** Compact one-line stats: ⏱️ 7m 46s  |  📊 4/4 节点  |  💰 $0.69 */
function buildCompactStats(task: TaskCardInfo, duration: string): string {
  const parts = [`⏱️ ${duration}`]
  if (task.totalNodes != null) {
    parts.push(`📊 ${task.nodesCompleted ?? 0}/${task.totalNodes} 节点`)
  }
  if (task.totalCostUsd != null && task.totalCostUsd > 0) {
    parts.push(`💰 $${task.totalCostUsd.toFixed(2)}`)
  }
  return parts.join('  |  ')
}

/** Build node execution overview lines */
function buildNodeOverview(nodes: TaskNodeInfo[]): string {
  return nodes
    .map(n => {
      const emoji = nodeStatusEmoji(n.status)
      const dur = n.durationMs ? formatDuration(n.durationMs) : ''
      return dur ? `${emoji} ${n.name} (${dur})` : `${emoji} ${n.name}`
    })
    .join('\n')
}

function formatTaskLineLark(item: TaskListItem): string {
  return `${statusEmoji(item.status)} **${item.shortId}** ${item.title}  ${item.relativeTime}`
}

// ── Card builders ──

export function buildTaskCompletedCard(task: TaskCardInfo, duration: string): LarkCard {
  const elements: LarkCardElement[] = []

  elements.push(mdElement(`**${task.title}**`))
  elements.push(mdElement(buildCompactStats(task, duration)))

  if (task.nodes && task.nodes.length > 0) {
    elements.push(hrElement())
    elements.push(mdElement(buildNodeOverview(task.nodes)))
  }

  elements.push(hrElement())
  elements.push(
    actionElement([
      button('📋 查看详情', 'primary', taskDetailAction(task.id)),
      button('📝 查看日志', 'default', taskLogsAction(task.id)),
    ])
  )

  const completedTime = new Date().toLocaleString('zh-CN')
  elements.push(noteElement(`${task.id.slice(0, 20)} · ${completedTime}`))

  return buildCard('✅ 任务完成', 'green', elements)
}

export function buildTaskFailedCard(task: TaskCardInfo, duration: string, error: string): LarkCard {
  const elements: LarkCardElement[] = []

  elements.push(mdElement(`**${task.title}**`))
  elements.push(mdElement(buildCompactStats(task, duration)))

  if (task.nodes && task.nodes.length > 0) {
    elements.push(hrElement())
    elements.push(mdElement(buildNodeOverview(task.nodes)))
  }

  const truncatedError = error.length > 200 ? error.slice(0, 197) + '...' : error
  elements.push(hrElement())
  elements.push(mdElement(`❌ **错误**: ${truncatedError}`))

  elements.push(hrElement())
  elements.push(
    actionElement([
      button('📋 查看详情', 'default', taskDetailAction(task.id)),
      button('📝 查看日志', 'default', taskLogsAction(task.id)),
      button('🔄 重试', 'primary', taskRetryAction(task.id)),
    ])
  )

  const failedTime = new Date().toLocaleString('zh-CN')
  elements.push(noteElement(`${task.id.slice(0, 20)} · ${failedTime}`))

  return buildCard('❌ 任务失败', 'red', elements)
}

export function buildTaskListCard(
  groups: { active: TaskListItem[]; completed: TaskListItem[] },
  counts: { total: number; activeCount: number; completedCount: number },
  page: number,
  totalPages: number,
  statusFilter?: string
): LarkCard {
  const elements: LarkCardElement[] = []

  // Active group
  if (groups.active.length > 0) {
    elements.push(mdElement(`**🔄 进行中 (${counts.activeCount})**`))
    for (const t of groups.active) {
      elements.push(mdElement(formatTaskLineLark(t)))
      const buttons = [
        button('📋 详情', 'primary', taskDetailAction(t.id)),
        button('📜 日志', 'default', taskLogsAction(t.id)),
      ]
      if (t.status === 'paused') {
        buttons.push(button('▶️ 继续', 'primary', taskResumeAction(t.id)))
      } else if (t.status === 'developing') {
        buttons.push(button('⏸️ 暂停', 'default', taskPauseAction(t.id)))
      }
      buttons.push(button('🛑 停止', 'danger', taskStopAction(t.id)))
      elements.push(actionElement(buttons))
    }
  }

  if (groups.active.length > 0 && groups.completed.length > 0) {
    elements.push(hrElement())
  }

  // Completed group
  if (groups.completed.length > 0) {
    elements.push(mdElement(`**✅ 已完成 (${counts.completedCount})**`))
    for (const t of groups.completed) {
      elements.push(mdElement(formatTaskLineLark(t)))
      elements.push(
        actionElement([
          button('📋 详情', 'default', taskDetailAction(t.id)),
        ])
      )
    }
  }

  // Empty state
  if (groups.active.length === 0 && groups.completed.length === 0) {
    elements.push(mdElement('暂无任务'))
  }

  // Pagination
  if (totalPages > 1) {
    elements.push(hrElement())
    const buttons: LarkCardButton[] = []
    if (page > 1) {
      buttons.push(
        button('⬅️ 上一页', 'default', listPageAction(page - 1, statusFilter))
      )
    }
    if (page < totalPages) {
      buttons.push(
        button('➡️ 下一页', 'default', listPageAction(page + 1, statusFilter))
      )
    }
    elements.push(actionElement(buttons))
    elements.push(noteElement(`第 ${page}/${totalPages} 页 · 共 ${counts.total} 个任务`))
  }

  elements.push(noteElement('💡 发送 /get <ID> 查看详情 | ID 支持前缀匹配'))

  return buildCard(`📋 任务列表 (${counts.total})`, 'blue', elements)
}

export function buildTaskDetailCard(
  task: TaskDetailInput,
  instance?: WorkflowInstance | null,
  workflow?: Workflow | null
): LarkCard {
  const elements: LarkCardElement[] = []

  const createdAt = new Date(task.createdAt).toLocaleString('zh-CN')
  const lines = [
    `**ID**: \`${task.id}\``,
    `**状态**: ${statusEmoji(task.status)} ${task.status}`,
    `**优先级**: ${task.priority}`,
    `**创建**: ${createdAt}`,
  ]

  if (task.assignee) lines.push(`**指派**: ${task.assignee}`)

  if (task.output?.timing?.startedAt && task.output?.timing?.completedAt) {
    const duration =
      new Date(task.output.timing.completedAt).getTime() -
      new Date(task.output.timing.startedAt).getTime()
    if (duration > 0) {
      lines.push(`**耗时**: ${formatDuration(duration)}`)
    }
  }

  if (task.description && task.description !== task.title) {
    const desc =
      task.description.length > 200 ? task.description.slice(0, 197) + '...' : task.description
    lines.push('', `**描述**: ${desc}`)
  }

  elements.push(mdElement(lines.join('\n')))

  // Node timeline
  if (instance && workflow) {
    const nodeMap = new Map<string, WorkflowNode>()
    for (const node of workflow.nodes) nodeMap.set(node.id, node)

    const timelineLines: string[] = ['**📊 节点执行时间线**', '']

    const nodeEntries = Object.entries(instance.nodeStates).sort((a, b) => {
      const aTime = a[1].startedAt ? new Date(a[1].startedAt).getTime() : Infinity
      const bTime = b[1].startedAt ? new Date(b[1].startedAt).getTime() : Infinity
      return aTime - bTime
    })

    for (const [nodeId, state] of nodeEntries) {
      const node = nodeMap.get(nodeId)
      const name = node?.name || nodeId
      const emoji = nodeStatusEmoji(state.status)
      const dur = state.durationMs ? formatDuration(state.durationMs) : '-'

      timelineLines.push(`${emoji} **${name}**  ${dur}`)

      const output = instance.outputs[nodeId]
      if (output && typeof output === 'string') {
        const preview = output.split('\n').slice(0, 3).join('\n')
        const truncated = preview.length > 200 ? preview.slice(0, 197) + '...' : preview
        timelineLines.push(`> ${truncated.replace(/\n/g, '\n> ')}`)
      }

      if (state.error) {
        const errPreview = state.error.length > 100 ? state.error.slice(0, 97) + '...' : state.error
        timelineLines.push(`> ❌ ${errPreview}`)
      }
    }

    elements.push(hrElement())
    elements.push(mdElement(timelineLines.join('\n')))
  }

  // Action buttons
  const buttons: LarkCardButton[] = [
    button('📜 日志', 'default', taskLogsAction(task.id)),
  ]
  if (task.status === 'completed' || task.status === 'failed') {
    buttons.push(button('📄 查看结果', 'primary', taskViewResultAction(task.id)))
  }
  if (task.status === 'failed') {
    buttons.push(button('🔄 重试', 'primary', taskRetryAction(task.id)))
  }
  if (task.status === 'paused') {
    buttons.push(button('▶️ 继续', 'primary', taskResumeAction(task.id)))
  }
  if (task.status === 'developing') {
    buttons.push(button('⏸️ 暂停', 'default', taskPauseAction(task.id)))
    buttons.push(button('💬 发消息', 'default', taskMsgAction(task.id)))
  }
  elements.push(hrElement())
  elements.push(actionElement(buttons))

  return buildCard(`📌 ${task.title}`, 'blue', elements)
}

export function buildTaskLogsCard(taskId: string, logs: string): LarkCard {
  const shortId = taskId.replace(/^task-/, '').slice(0, 8)
  const truncated = logs.length > 3000 ? '...\n' + logs.slice(-3000) : logs
  return buildCard(`📜 日志 ${shortId}`, 'blue', [
    mdElement(`\`\`\`\n${truncated}\n\`\`\``),
    noteElement(`任务 ID: ${taskId}`),
  ])
}
