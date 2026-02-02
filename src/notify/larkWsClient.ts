/**
 * 飞书 WebSocket 长连接客户端
 * 无需公网 IP，通过长连接主动接收事件
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../shared/logger.js'
import { loadConfig } from '../config/loadConfig.js'
import {
  getWaitingHumanJobs,
  resumeWaitingJob,
  markJobFailed,
} from '../workflow/queue/WorkflowQueue.js'
import {
  markNodeDone,
  markNodeFailed as stateMarkNodeFailed,
} from '../workflow/engine/StateManager.js'
import { handleNodeResult, getWorkflow } from '../workflow/index.js'
import { sendApprovalResultNotification } from './sendLarkNotify.js'

const logger = createLogger('lark-ws')

let wsClient: Lark.WSClient | null = null
let larkClient: Lark.Client | null = null

interface ParsedApproval {
  action: 'approve' | 'reject'
  reason?: string
  nodeId?: string
}

/**
 * 解析审批指令
 */
function parseApprovalCommand(text: string): ParsedApproval | null {
  // 移除 @mention
  const cleanText = text.replace(/@[\w\u4e00-\u9fa5]+/g, '').trim()

  // 通过/approve
  if (/^(通过|approve|批准|ok|yes)$/i.test(cleanText)) {
    return { action: 'approve' }
  }

  // 通过 + 节点ID
  const approveMatch = cleanText.match(/^(通过|approve|批准)\s+(\S+)$/i)
  if (approveMatch) {
    return { action: 'approve', nodeId: approveMatch[2] }
  }

  // 拒绝/reject
  if (/^(拒绝|reject|no|否)$/i.test(cleanText)) {
    return { action: 'reject' }
  }

  // 拒绝 + 原因
  const rejectMatch = cleanText.match(/^(拒绝|reject)\s+(.+)$/i)
  if (rejectMatch) {
    return { action: 'reject', reason: rejectMatch[2] }
  }

  return null
}

/**
 * 处理审批操作
 */
async function handleApproval(approval: ParsedApproval): Promise<string> {
  const waitingJobs = getWaitingHumanJobs()

  if (waitingJobs.length === 0) {
    return '没有待审批的节点'
  }

  // 如果指定了节点 ID，查找匹配的
  let targetJob = waitingJobs[0]
  if (approval.nodeId) {
    const found = waitingJobs.find(j =>
      j.data.nodeId === approval.nodeId ||
      j.data.nodeId.startsWith(approval.nodeId!)
    )
    if (!found) {
      return `未找到节点: ${approval.nodeId}\n当前等待审批的节点: ${waitingJobs.map(j => j.data.nodeId).join(', ')}`
    }
    targetJob = found
  }

  if (!targetJob) {
    return '没有待审批的节点'
  }

  const { instanceId, nodeId, workflowId } = targetJob.data

  try {
    if (approval.action === 'approve') {
      // 标记任务完成
      resumeWaitingJob(targetJob.id)
      await markNodeDone(instanceId, nodeId, { approved: true })

      // 处理下游节点
      const workflow = getWorkflow(workflowId)
      if (workflow) {
        await handleNodeResult(workflowId, instanceId, nodeId, {
          success: true,
          output: { approved: true },
        })
      }

      // 发送通知
      const config = await loadConfig()
      const webhookUrl = config.notify?.lark?.webhookUrl
      if (webhookUrl) {
        await sendApprovalResultNotification(webhookUrl, {
          nodeId,
          nodeName: nodeId,
          approved: true,
        })
      }

      return `✅ 已批准节点: ${nodeId}`
    } else {
      // 拒绝
      const reason = approval.reason || '用户拒绝'
      markJobFailed(targetJob.id, reason)
      await stateMarkNodeFailed(instanceId, nodeId, reason)

      // 发送通知
      const config = await loadConfig()
      const webhookUrl = config.notify?.lark?.webhookUrl
      if (webhookUrl) {
        await sendApprovalResultNotification(webhookUrl, {
          nodeId,
          nodeName: nodeId,
          approved: false,
          reason,
        })
      }

      return `❌ 已拒绝节点: ${nodeId}\n原因: ${reason}`
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to handle approval: ${errorMessage}`)
    return `处理失败: ${errorMessage}`
  }
}

/**
 * 回复飞书消息
 */
async function replyMessage(chatId: string, text: string): Promise<void> {
  if (!larkClient) return

  try {
    await larkClient.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    })
  } catch (error) {
    logger.error('Failed to reply message:', error)
  }
}

/**
 * 启动飞书 WebSocket 客户端
 */
export async function startLarkWsClient(): Promise<void> {
  if (wsClient) {
    logger.warn('Lark WebSocket client already running')
    return
  }

  const config = await loadConfig()
  const { appId, appSecret } = config.notify?.lark || {}

  if (!appId || !appSecret) {
    throw new Error('Missing Lark appId or appSecret in config')
  }

  const baseConfig = { appId, appSecret }

  // 创建 API 客户端（用于回复消息）
  larkClient = new Lark.Client(baseConfig)

  // 创建 WebSocket 客户端
  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  // 启动并注册事件处理
  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const message = data.message
        if (!message) return

        // 只处理文本消息
        if (message.message_type !== 'text') return

        // 解析消息内容
        let content: { text?: string }
        try {
          content = JSON.parse(message.content || '{}')
        } catch {
          return
        }

        const text = content.text || ''
        const chatId = message.chat_id || ''

        // 检查是否 @了机器人
        const hasMention = message.mentions && message.mentions.length > 0

        if (!hasMention && message.chat_type === 'group') {
          // 群聊中没有 @机器人，忽略
          return
        }

        logger.info(`Received message: ${text}`)

        // 解析审批指令
        const approval = parseApprovalCommand(text)
        if (!approval) {
          // 不是审批指令，回复帮助信息
          if (hasMention) {
            await replyMessage(chatId, '支持的指令:\n- 通过/approve: 批准当前节点\n- 拒绝/reject [原因]: 拒绝当前节点')
          }
          return
        }

        // 处理审批
        const result = await handleApproval(approval)
        logger.info(`Approval result: ${result}`)

        // 回复处理结果
        await replyMessage(chatId, result)
      },
    }),
  })

  logger.info('Lark WebSocket client started')
}

/**
 * 停止飞书 WebSocket 客户端
 */
export async function stopLarkWsClient(): Promise<void> {
  if (!wsClient) return

  // SDK 没有提供 stop 方法，设置为 null 让 GC 回收
  wsClient = null
  larkClient = null
  logger.info('Lark WebSocket client stopped')
}

/**
 * 检查客户端是否运行中
 */
export function isLarkWsClientRunning(): boolean {
  return wsClient !== null
}
