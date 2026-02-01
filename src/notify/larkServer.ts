/**
 * 飞书事件监听服务器
 * 接收 @机器人 消息，处理审批指令
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
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
import { sendApprovalResultNotification } from './lark.js'

const logger = createLogger('lark-server')

interface LarkEventBody {
  // 验证请求
  challenge?: string

  // 事件类型
  type?: string

  // 2.0 事件格式
  schema?: string
  header?: {
    event_id: string
    event_type: string
    create_time: string
    token: string
    app_id: string
  }
  event?: {
    message?: {
      message_id: string
      root_id?: string
      parent_id?: string
      create_time: string
      chat_id: string
      chat_type: string
      message_type: string
      content: string
      mentions?: Array<{
        key: string
        id: {
          union_id: string
          user_id: string
          open_id: string
        }
        name: string
      }>
    }
    sender?: {
      sender_id: {
        union_id: string
        user_id: string
        open_id: string
      }
      sender_type: string
    }
  }
}

interface ParsedApproval {
  action: 'approve' | 'reject'
  reason?: string
  nodeId?: string  // 可选指定节点 ID
}

let server: ReturnType<typeof createServer> | null = null

/**
 * 解析审批指令
 * 支持格式：
 * - "通过"
 * - "approve"
 * - "拒绝"
 * - "reject"
 * - "拒绝 原因"
 * - "通过 node-id"
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
 * 处理飞书事件
 */
async function handleLarkEvent(body: LarkEventBody): Promise<string | object> {
  // 验证请求（飞书首次配置 URL 时会发送）
  if (body.challenge) {
    logger.info('Received Lark verification challenge')
    return { challenge: body.challenge }
  }

  // 2.0 事件格式
  if (body.header?.event_type === 'im.message.receive_v1') {
    const message = body.event?.message
    if (!message) return 'ok'

    // 只处理文本消息
    if (message.message_type !== 'text') {
      return 'ok'
    }

    // 解析消息内容
    let content: { text?: string }
    try {
      content = JSON.parse(message.content)
    } catch {
      return 'ok'
    }

    const text = content.text || ''

    // 检查是否 @了机器人
    const hasMention = message.mentions && message.mentions.length > 0

    if (!hasMention) {
      // 群聊中没有 @机器人，忽略
      if (message.chat_type === 'group') {
        return 'ok'
      }
    }

    logger.info(`Received message: ${text}`)

    // 解析审批指令
    const approval = parseApprovalCommand(text)
    if (!approval) {
      return 'ok'  // 不是审批指令，忽略
    }

    // 处理审批
    const result = await handleApproval(approval)
    logger.info(`Approval result: ${result}`)

    // 返回 ok，实际回复通过 webhook 发送
    return 'ok'
  }

  return 'ok'
}

/**
 * 启动飞书事件监听服务器
 */
export async function startLarkServer(port?: number): Promise<void> {
  if (server) {
    logger.warn('Lark server already running')
    return
  }

  const config = await loadConfig()
  const serverPort = port || config.notify?.lark?.serverPort || 3000

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // 只接受 POST 请求
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end('Method Not Allowed')
      return
    }

    // 收集请求体
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))

    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as LarkEventBody

        const result = await handleLarkEvent(body)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(typeof result === 'string' ? { msg: result } : result))
      } catch (error) {
        logger.error('Failed to process request:', error)
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    })
  })

  server.listen(serverPort, () => {
    logger.info(`Lark event server listening on port ${serverPort}`)
  })
}

/**
 * 停止飞书事件监听服务器
 */
export async function stopLarkServer(): Promise<void> {
  if (!server) {
    return
  }

  return new Promise((resolve, reject) => {
    server!.close((err) => {
      if (err) {
        reject(err)
      } else {
        server = null
        logger.info('Lark server stopped')
        resolve()
      }
    })
  })
}

/**
 * 检查服务器是否运行中
 */
export function isLarkServerRunning(): boolean {
  return server !== null && server.listening
}
