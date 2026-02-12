/** Lark interactive card builder — pure functions for constructing card JSON */

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
  value?: CardActionPayload | Record<string, string>
}

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
  value: CardActionPayload | Record<string, string>
): LarkCardButton {
  return { tag: 'button', text: { tag: 'plain_text', content: label }, type, value }
}

import { statusEmoji } from './handlers/constants.js'
import { formatDuration } from '../shared/formatTime.js'
import type { WorkflowInstance, Workflow, WorkflowNode } from '../workflow/types.js'
import type {
  CardActionPayload,
  TaskDetailPayload,
  TaskLogsPayload,
  TaskStopPayload,
  TaskRetryPayload,
  ListPagePayload,
  ApprovePayload,
  RejectPayload,
} from './handlers/types.js'

export function taskDetailAction(taskId: string): TaskDetailPayload {
  return { action: 'task_detail', taskId }
}

export function taskLogsAction(taskId: string): TaskLogsPayload {
  return { action: 'task_logs', taskId }
}

export function taskStopAction(taskId: string): TaskStopPayload {
  return { action: 'task_stop', taskId }
}

export function taskRetryAction(taskId: string): TaskRetryPayload {
  return { action: 'task_retry', taskId }
}

export function listPageAction(page: number, filter?: string): ListPagePayload {
  return { action: 'list_page', page: String(page), ...(filter ? { filter } : {}) }
}

export function approveAction(nodeId: string, workflowId?: string, instanceId?: string): ApprovePayload {
  return { action: 'approve', nodeId, workflowId, instanceId }
}

export function rejectAction(nodeId: string, workflowId?: string, instanceId?: string): RejectPayload {
  return { action: 'reject', nodeId, workflowId, instanceId }
}

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

export function buildTaskCompletedCard(task: TaskCardInfo, duration: string): LarkCard {
  const elements: LarkCardElement[] = []

  // Title (full, no truncation)
  elements.push(mdElement(`**${task.title}**`))

  // Compact stats line
  elements.push(mdElement(buildCompactStats(task, duration)))

  // Node execution overview
  if (task.nodes && task.nodes.length > 0) {
    elements.push(hrElement())
    elements.push(mdElement(buildNodeOverview(task.nodes)))
  }

  // Action buttons
  elements.push(hrElement())
  elements.push(
    actionElement([
      button('📋 查看详情', 'primary', taskDetailAction(task.id)),
      button('📝 查看日志', 'default', taskLogsAction(task.id)),
    ])
  )

  // Footer note
  const completedTime = new Date().toLocaleString('zh-CN')
  elements.push(noteElement(`${task.id.slice(0, 20)} · ${completedTime}`))

  return buildCard('✅ 任务完成', 'green', elements)
}

export function buildTaskFailedCard(task: TaskCardInfo, duration: string, error: string): LarkCard {
  const elements: LarkCardElement[] = []

  // Title
  elements.push(mdElement(`**${task.title}**`))

  // Compact stats line
  elements.push(mdElement(buildCompactStats(task, duration)))

  // Node execution overview
  if (task.nodes && task.nodes.length > 0) {
    elements.push(hrElement())
    elements.push(mdElement(buildNodeOverview(task.nodes)))
  }

  // Error info
  const truncatedError = error.length > 200 ? error.slice(0, 197) + '...' : error
  elements.push(hrElement())
  elements.push(mdElement(`❌ **错误**: ${truncatedError}`))

  // Action buttons (with retry)
  elements.push(hrElement())
  elements.push(
    actionElement([
      button('📋 查看详情', 'default', taskDetailAction(task.id)),
      button('📝 查看日志', 'default', taskLogsAction(task.id)),
      button('🔄 重试', 'primary', taskRetryAction(task.id)),
    ])
  )

  // Footer note
  const failedTime = new Date().toLocaleString('zh-CN')
  elements.push(noteElement(`${task.id.slice(0, 20)} · ${failedTime}`))

  return buildCard('❌ 任务失败', 'red', elements)
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
      button('✅ 通过', 'primary', approveAction(nodeId, workflowId, instanceId)),
      button('❌ 拒绝', 'danger', rejectAction(nodeId, workflowId, instanceId)),
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
  return `${statusEmoji(item.status)} **${item.shortId}** ${item.title}  ${item.relativeTime}`
}

export function buildTaskListCard(
  groups: { active: TaskListItem[]; completed: TaskListItem[] },
  counts: { total: number; activeCount: number; completedCount: number },
  page: number,
  totalPages: number,
  statusFilter?: string
): LarkCard {
  const elements: LarkCardElement[] = []

  // Active group — each task is a markdown line + inline action buttons
  if (groups.active.length > 0) {
    elements.push(mdElement(`**🔄 进行中 (${counts.activeCount})**`))
    for (const t of groups.active) {
      elements.push(mdElement(formatTaskLineLark(t)))
      elements.push(
        actionElement([
          button('📋 详情', 'primary', taskDetailAction(t.id)),
          button('📜 日志', 'default', taskLogsAction(t.id)),
          button('🛑 停止', 'danger', taskStopAction(t.id)),
        ])
      )
    }
  }

  // Separator between groups
  if (groups.active.length > 0 && groups.completed.length > 0) {
    elements.push(hrElement())
  }

  // Completed group — compact, one button per task
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

export function buildTaskDetailCard(
  task: TaskDetailInput,
  instance?: WorkflowInstance | null,
  workflow?: Workflow | null
): LarkCard {
  const elements: LarkCardElement[] = []

  // Basic info
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

  // Node timeline (if instance and workflow available)
  if (instance && workflow) {
    const nodeMap = new Map<string, WorkflowNode>()
    for (const node of workflow.nodes) nodeMap.set(node.id, node)

    const timelineLines: string[] = ['**📊 节点执行时间线**', '']

    // Sort nodes by startedAt, put unstarted ones at the end
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

      // Show first 3 lines of output if available
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
  if (task.status === 'failed') {
    buttons.push(button('🔄 重试', 'primary', taskRetryAction(task.id)))
  }
  elements.push(hrElement())
  elements.push(actionElement(buttons))

  return buildCard(`📌 ${task.title}`, 'blue', elements)
}

export function buildTaskLogsCard(taskId: string, logs: string): LarkCard {
  const shortId = taskId.replace(/^task-/, '').slice(0, 8)
  // Lark markdown code block for logs
  const truncated = logs.length > 3000 ? '...\n' + logs.slice(-3000) : logs
  return buildCard(`📜 日志 ${shortId}`, 'blue', [
    mdElement(`\`\`\`\n${truncated}\n\`\`\``),
    noteElement(`任务 ID: ${taskId}`),
  ])
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
        '',
        '**💰 统计**',
        '`/cost` - 查看对话费用统计',
        '',
        '**🔧 系统**',
        '`/reload` - 重启守护进程（加载新代码）',
      ].join('\n')
    ),
    noteElement('直接发送文字即可与 AI 对话 | taskId 支持前缀匹配'),
  ])
}
