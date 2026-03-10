/**
 * Notification facade for workflow/runtime callers.
 *
 * Workflow should depend on this module instead of platform-specific
 * messaging implementations.
 */
import { getLarkConfig } from '../config/index.js'
import {
  buildApprovalCard,
  buildAutoWaitCard,
  buildCard,
  getDefaultLarkChatId,
  normalizeLarkMarkdown,
  sendLarkCardViaApi,
  sendReviewNotification,
} from '../messaging/index.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('notification')

type MarkdownElement = { tag: 'markdown'; content: string }
type HrElement = { tag: 'hr' }

async function resolveLarkTargets(preferredChatId?: string): Promise<{
  chatId?: string
  webhookUrl?: string
}> {
  const larkConfig = await getLarkConfig()
  return {
    chatId: preferredChatId ?? larkConfig?.chatId ?? getDefaultLarkChatId() ?? undefined,
    webhookUrl: larkConfig?.webhookUrl,
  }
}

export async function sendApprovalRequest(params: {
  taskTitle: string
  workflowName: string
  workflowId: string
  instanceId: string
  nodeId: string
  nodeName: string
}): Promise<boolean> {
  const { chatId, webhookUrl } = await resolveLarkTargets()

  if (chatId) {
    const card = buildApprovalCard(params)
    const sent = await sendLarkCardViaApi(chatId, card)
    if (sent) return true
  }

  if (!webhookUrl) {
    logger.warn('Approval notification skipped: no Lark chatId or webhook configured')
    return false
  }

  return await sendReviewNotification({
    ...params,
    webhookUrl,
  })
}

export async function sendAutoWaitPause(params: {
  workflowName: string
  nodeName: string
  taskId?: string
  nodeDescription?: string
}): Promise<boolean> {
  const { chatId, webhookUrl } = await resolveLarkTargets()

  if (chatId && params.taskId) {
    const card = buildAutoWaitCard({
      taskId: params.taskId,
      taskTitle: params.workflowName,
      nodeName: params.nodeName,
      nodeDescription: params.nodeDescription,
    })
    const sent = await sendLarkCardViaApi(chatId, card)
    if (sent) return true
  }

  if (!webhookUrl) {
    logger.warn('Auto-wait notification skipped: no Lark chatId or webhook configured')
    return false
  }

  return await sendReviewNotification({
    webhookUrl,
    taskTitle: params.workflowName,
    workflowName: params.workflowName,
    workflowId: '',
    instanceId: '',
    nodeId: '',
    nodeName: `[autoWait] ${params.nodeName}`,
  })
}

export async function sendLarkMarkdownNotification(params: {
  title?: string
  text: string
  chatId?: string
}): Promise<boolean> {
  const { chatId } = await resolveLarkTargets(params.chatId)
  if (!chatId) {
    logger.warn('Markdown notification skipped: no Lark chatId configured')
    return false
  }

  const sections = params.text.split(/^(?:---+|\*\*\*+|___+)\s*$/m)
  const elements: Array<MarkdownElement | HrElement> = []

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!.trim()
    if (section) {
      elements.push({ tag: 'markdown', content: normalizeLarkMarkdown(section) })
    }
    if (i < sections.length - 1) {
      elements.push({ tag: 'hr' })
    }
  }

  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: params.text })
  }

  const card = buildCard(params.title || '任务通知', 'blue', elements)
  return await sendLarkCardViaApi(chatId, card)
}
