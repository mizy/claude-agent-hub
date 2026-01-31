/**
 * 飞书/Lark 通知模块
 * 发送卡片消息通知用户审批
 */

import { createLogger } from '../shared/logger.js'

const logger = createLogger('lark-notify')

export interface ReviewNotificationOptions {
  webhookUrl: string
  taskTitle: string
  workflowName: string
  workflowId: string
  instanceId: string
  nodeId: string
  nodeName: string
}

interface LarkCardMessage {
  msg_type: 'interactive'
  card: {
    config?: {
      wide_screen_mode: boolean
    }
    header: {
      title: {
        tag: 'plain_text'
        content: string
      }
      template?: string
    }
    elements: Array<{
      tag: string
      content?: string
      actions?: Array<{
        tag: 'button'
        text: { tag: 'plain_text'; content: string }
        type?: string
        value?: Record<string, string>
        url?: string
      }>
    }>
  }
}

/**
 * 发送审批通知到飞书
 */
export async function sendReviewNotification(
  options: ReviewNotificationOptions
): Promise<boolean> {
  const {
    webhookUrl,
    taskTitle,
    workflowName,
    workflowId,
    instanceId,
    nodeId,
    nodeName,
  } = options

  const shortInstanceId = instanceId.slice(0, 8)

  const message: LarkCardMessage = {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '🔔 需要审批',
        },
        template: 'orange',
      },
      elements: [
        {
          tag: 'markdown',
          content: [
            `**任务**: ${taskTitle}`,
            `**工作流**: ${workflowName}`,
            `**节点**: ${nodeName}`,
            `**实例**: ${shortInstanceId}`,
            '',
            '---',
            '',
            '通过 CLI 命令审批:',
            '```',
            `cah workflow approve ${workflowId.slice(0, 8)} ${nodeId}`,
            '```',
            '',
            '或回复本消息: `通过` / `拒绝 [原因]`',
          ].join('\n'),
        },
      ],
    },
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error(`Failed to send Lark notification: ${response.status} ${text}`)
      return false
    }

    const result = await response.json() as { code?: number; msg?: string }
    if (result.code !== 0) {
      logger.error(`Lark webhook error: ${result.msg}`)
      return false
    }

    logger.info(`Sent review notification for node ${nodeId}`)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send Lark notification: ${errorMessage}`)
    return false
  }
}

/**
 * 发送简单文本消息
 */
export async function sendLarkMessage(
  webhookUrl: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text },
      }),
    })

    if (!response.ok) {
      logger.error(`Failed to send Lark message: ${response.status}`)
      return false
    }

    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to send Lark message: ${errorMessage}`)
    return false
  }
}

/**
 * 发送审批结果通知
 */
export async function sendApprovalResultNotification(
  webhookUrl: string,
  options: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }
): Promise<boolean> {
  const { nodeId, nodeName, approved, reason } = options
  const status = approved ? '✅ 已通过' : '❌ 已拒绝'
  const reasonText = reason ? `\n原因: ${reason}` : ''

  const message = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: `审批结果: ${nodeName}`,
        },
        template: approved ? 'green' : 'red',
      },
      elements: [
        {
          tag: 'markdown',
          content: `**状态**: ${status}${reasonText}\n**节点**: ${nodeId}`,
        },
      ],
    },
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })

    return response.ok
  } catch {
    return false
  }
}
