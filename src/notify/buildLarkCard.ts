/**
 * Lark interactive card builder — pure functions for constructing card JSON
 *
 * Cards follow Lark Open Platform message card v1 schema:
 * header (title + color template) + elements (markdown, hr, action buttons, note)
 */

// ── Types ──

export interface LarkCard {
  config?: { wide_screen_mode: boolean }
  header: {
    title: { tag: 'plain_text'; content: string }
    template?: string // blue | green | red | orange | purple | turquoise | yellow | ...
  }
  elements: LarkCardElement[]
}

export type LarkCardElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | { tag: 'note'; elements: Array<{ tag: 'plain_text'; content: string }> }
  | { tag: 'action'; actions: LarkCardButton[] }

export interface LarkCardButton {
  tag: 'button'
  text: { tag: 'plain_text'; content: string }
  type?: 'primary' | 'danger' | 'default'
  value?: Record<string, string>
}

// ── Primitive builders ──

export function buildCard(title: string, template: string, elements: LarkCardElement[]): LarkCard {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    elements,
  }
}

export function mdElement(content: string): LarkCardElement {
  return { tag: 'markdown', content }
}

export function hrElement(): LarkCardElement {
  return { tag: 'hr' }
}

export function noteElement(text: string): LarkCardElement {
  return { tag: 'note', elements: [{ tag: 'plain_text', content: text }] }
}

export function actionElement(buttons: LarkCardButton[]): LarkCardElement {
  return { tag: 'action', actions: buttons }
}

export function button(
  label: string,
  type: 'primary' | 'danger' | 'default',
  value: Record<string, string>
): LarkCardButton {
  return { tag: 'button', text: { tag: 'plain_text', content: label }, type, value }
}

import { statusEmoji } from './handlers/constants.js'

// ── Pre-built card templates ──

export interface TaskCardInfo {
  id: string
  title: string
  workflowName?: string
  nodesCompleted?: number
  nodesFailed?: number
  totalNodes?: number
  totalCostUsd?: number
  outputSummary?: string
}

function buildTaskStatsLines(task: TaskCardInfo, duration: string): string[] {
  const lines = [`**标题**: ${task.title}`, `**耗时**: ${duration}`]
  if (task.workflowName) {
    lines.push(`**工作流**: ${task.workflowName}`)
  }
  if (task.totalNodes != null) {
    const failedPart = task.nodesFailed ? `，${task.nodesFailed} 失败` : ''
    lines.push(`**节点**: ${task.nodesCompleted ?? 0}/${task.totalNodes} 完成${failedPart}`)
  }
  if (task.totalCostUsd != null && task.totalCostUsd > 0) {
    lines.push(`**费用**: $${task.totalCostUsd.toFixed(4)}`)
  }
  lines.push(`**ID**: ${task.id.slice(0, 20)}`)
  return lines
}

export function buildTaskCompletedCard(task: TaskCardInfo, duration: string): LarkCard {
  const elements: LarkCardElement[] = [mdElement(buildTaskStatsLines(task, duration).join('\n'))]
  if (task.outputSummary) {
    elements.push(hrElement())
    elements.push(mdElement(`📝 **输出摘要**\n${task.outputSummary}`))
  }
  return buildCard('✅ 任务完成', 'green', elements)
}

export function buildTaskFailedCard(task: TaskCardInfo, duration: string, error: string): LarkCard {
  const truncatedError = error.length > 200 ? error.slice(0, 197) + '...' : error
  const lines = buildTaskStatsLines(task, duration)
  lines.push('', `**错误**: ${truncatedError}`)
  return buildCard('❌ 任务失败', 'red', [mdElement(lines.join('\n'))])
}

export function buildApprovalCard(options: {
  taskTitle: string
  workflowName: string
  workflowId: string
  instanceId: string
  nodeId: string
  nodeName: string
}): LarkCard {
  const { taskTitle, workflowName, workflowId, instanceId, nodeId, nodeName } = options
  const shortInstanceId = instanceId.slice(0, 8)

  return buildCard('🔔 需要审批', 'orange', [
    mdElement(
      [
        `**任务**: ${taskTitle}`,
        `**工作流**: ${workflowName}`,
        `**节点**: ${nodeName}`,
        `**实例**: ${shortInstanceId}`,
      ].join('\n')
    ),
    hrElement(),
    actionElement([
      button('✅ 通过', 'primary', {
        action: 'approve',
        workflowId,
        instanceId,
        nodeId,
      }),
      button('❌ 拒绝', 'danger', {
        action: 'reject',
        workflowId,
        instanceId,
        nodeId,
      }),
    ]),
    noteElement('也可回复: 通过 / 拒绝 [原因]'),
  ])
}

export function buildWelcomeCard(): LarkCard {
  return buildCard('🤖 Claude Agent Hub', 'blue', [
    mdElement(
      [
        '欢迎使用 Claude Agent Hub!',
        '',
        '你可以通过以下方式与我交互:',
        '• 发送 `/help` 查看所有指令',
        '• 发送 `/run <描述>` 创建任务',
        '• 发送 `/list` 查看任务列表',
        '• 直接发送文字与 AI 对话',
      ].join('\n')
    ),
  ])
}

export interface TaskListItem {
  id: string
  shortId: string
  title: string
  status: string
  priority: string
  relativeTime: string
}

function formatTaskLineLark(item: TaskListItem): string {
  return `${statusEmoji(item.status)} \`${item.shortId}\`  ${item.title}  ${item.priority}  ${item.relativeTime}`
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
    const lines = [`**🔄 进行中 (${counts.activeCount})**`, '']
    lines.push(...groups.active.map(formatTaskLineLark))
    elements.push(mdElement(lines.join('\n')))
  }

  // Separator between groups
  if (groups.active.length > 0 && groups.completed.length > 0) {
    elements.push(hrElement())
  }

  // Completed group
  if (groups.completed.length > 0) {
    const lines = [`**✅ 已完成 (${counts.completedCount})**`, '']
    lines.push(...groups.completed.map(formatTaskLineLark))
    elements.push(mdElement(lines.join('\n')))
  }

  // Empty state (shouldn't happen but safe)
  if (groups.active.length === 0 && groups.completed.length === 0) {
    elements.push(mdElement('暂无任务'))
  }

  // Pagination
  if (totalPages > 1) {
    elements.push(hrElement())
    const buttons: LarkCardButton[] = []
    if (page > 1) {
      buttons.push(
        button('⬅️ 上一页', 'default', {
          action: 'list_page',
          page: String(page - 1),
          ...(statusFilter ? { filter: statusFilter } : {}),
        })
      )
    }
    if (page < totalPages) {
      buttons.push(
        button('➡️ 下一页', 'default', {
          action: 'list_page',
          page: String(page + 1),
          ...(statusFilter ? { filter: statusFilter } : {}),
        })
      )
    }
    elements.push(actionElement(buttons))
    elements.push(noteElement(`第 ${page}/${totalPages} 页 · 共 ${counts.total} 个任务`))
  }

  elements.push(noteElement('💡 发送 /get <ID> 查看任务详情'))

  return buildCard(`📋 任务列表 (${counts.total})`, 'blue', elements)
}

export function buildTaskDetailCard(task: {
  id: string
  title: string
  status: string
  priority: string
  createdAt: string
  assignee?: string
  description?: string
  output?: { timing?: { startedAt?: string; completedAt?: string } }
}): LarkCard {
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
      const secs = Math.round(duration / 1000)
      const m = Math.floor(secs / 60)
      const s = secs % 60
      lines.push(`**耗时**: ${m}m ${s}s`)
    }
  }

  if (task.description && task.description !== task.title) {
    const desc =
      task.description.length > 200 ? task.description.slice(0, 197) + '...' : task.description
    lines.push('', `**描述**: ${desc}`)
  }

  return buildCard(`📌 ${task.title}`, 'blue', [mdElement(lines.join('\n'))])
}

export function buildStatusCard(jobs: Array<{ nodeId: string; nodeName?: string }>): LarkCard {
  if (jobs.length === 0) {
    return buildCard('✅ 审批状态', 'green', [mdElement('没有待审批的节点')])
  }

  const lines = jobs.map(j => `• \`${j.nodeId}\`${j.nodeName ? ` (${j.nodeName})` : ''}`)
  lines.push('', '使用 /approve [nodeId] 或 /reject [原因] 操作')

  return buildCard(`🔔 待审批节点 (${jobs.length})`, 'orange', [mdElement(lines.join('\n'))])
}

export function buildHelpCard(): LarkCard {
  return buildCard('🤖 指令帮助', 'blue', [
    mdElement(
      [
        '**📋 任务管理**',
        '`/run <描述>` - 创建并执行任务',
        '`/list [status]` - 查看任务列表',
        '`/get <id>` - 查看任务详情',
        '`/logs <id>` - 查看任务日志',
        '`/stop <id>` - 停止任务',
        '`/resume <id>` - 恢复任务',
        '',
        '**✅ 审批**',
        '`/approve [nodeId]` - 批准节点',
        '`/reject [原因]` - 拒绝节点',
        '`/status` - 查看待审批节点',
        '',
        '**💬 对话**',
        '`/new` - 开始新对话',
        '`/chat` - 查看对话状态',
        '`/help` - 显示此帮助',
      ].join('\n')
    ),
    noteElement('直接发送文字即可与 AI 对话 | taskId 支持前缀匹配'),
  ])
}
