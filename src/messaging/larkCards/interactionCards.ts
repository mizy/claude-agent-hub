/**
 * Interaction cards — approval, auto-wait, welcome, status, help
 */

import {
  buildCard,
  mdElement,
  hrElement,
  noteElement,
  actionElement,
  button,
  approveAction,
  rejectAction,
  autoWaitConfirmAction,
  taskDetailAction,
  taskStopAction,
} from './cardElements.js'
import type { LarkCard } from './cardElements.js'

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

export function buildAutoWaitCard(options: {
  taskId: string
  taskTitle: string
  nodeName: string
  nodeDescription?: string
}): LarkCard {
  const { taskId, taskTitle, nodeName, nodeDescription } = options
  const lines = [
    `**任务**: ${taskTitle}`,
    `**节点**: ${nodeName}`,
  ]
  if (nodeDescription) {
    const desc = nodeDescription.length > 200 ? nodeDescription.slice(0, 197) + '...' : nodeDescription
    lines.push(`**描述**: ${desc}`)
  }
  lines.push('', '⚠️ 此节点包含高风险操作，已自动暂停等待确认')

  return buildCard('⏸️ 节点自动暂停', 'orange', [
    mdElement(lines.join('\n')),
    hrElement(),
    actionElement([
      button('✅ 确认继续', 'primary', autoWaitConfirmAction(taskId)),
      button('📋 查看详情', 'default', taskDetailAction(taskId)),
      button('🛑 停止任务', 'danger', taskStopAction(taskId)),
    ]),
    noteElement(`${taskId.slice(0, 20)} · 使用 /resume 恢复`),
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
        '`/pause <id>` - 暂停任务',
        '`/msg <id> <消息>` - 向任务发消息',
        '`/snapshot <id>` - 查看任务快照',
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
