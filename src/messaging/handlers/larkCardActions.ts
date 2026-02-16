/**
 * Lark card button action handlers
 *
 * Delegates to commandHandler functions to avoid duplicating business logic.
 * Each action function takes parsed params and returns a response to send.
 */

import { createLogger } from '../../shared/logger.js'
import { handleGet, handleLogs, handleStop, handleResume, handleList, handlePause } from './commandHandler.js'
import { handleApproval } from './approvalHandler.js'
import { resumePausedTask } from '../../task/index.js'
import { readOutputSummary } from '../../output/index.js'
import { buildCard, mdElement, noteElement } from '../larkCards/cardElements.js'
import type { MessengerAdapter, ParsedApproval, CardActionPayload } from './types.js'
import { parseCardActionPayload } from './types.js'

const logger = createLogger('card-actions')

export interface CardActionParams {
  chatId: string
  messageId?: string
  /** Raw action value from Lark SDK — will be parsed into CardActionPayload */
  value: Record<string, unknown>
  messenger: MessengerAdapter
  onApprovalResult?: (result: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }) => Promise<void>
}

/**
 * Dispatch a card button action. Returns a truthy value if the SDK
 * should suppress its default response (e.g. for in-place card updates).
 */
export async function dispatchCardAction(params: CardActionParams): Promise<unknown> {
  const { chatId, messageId, value, messenger, onApprovalResult } = params

  const payload = parseCardActionPayload(value)
  if (!payload) {
    logger.warn(`Invalid card action payload: ${JSON.stringify(value).slice(0, 200)}`)
    return undefined
  }

  logger.info(`← [card] action=${payload.action} chatId=${chatId} msgId=${messageId ?? '?'}`)

  switch (payload.action) {
    case 'approve':
    case 'reject':
      return handleApprovalAction(chatId, payload, messenger, onApprovalResult)

    case 'list_page':
      return handleListPageAction(chatId, messageId, payload, messenger)

    case 'task_detail':
      return handleTaskDetailAction(chatId, payload.taskId, messenger)

    case 'task_logs':
      return handleTaskLogsAction(chatId, payload.taskId, messenger)

    case 'task_stop':
      return handleTaskStopAction(chatId, payload.taskId, messenger)

    case 'task_retry':
      return handleTaskRetryAction(chatId, payload.taskId, messenger)

    case 'task_pause':
      return handleTaskPauseAction(chatId, payload.taskId, messenger)

    case 'task_resume':
    case 'auto_wait_confirm':
      return handleTaskResumeAction(chatId, payload.taskId, messenger)

    case 'task_msg':
      return handleTaskMsgPrompt(chatId, payload.taskId, messenger)

    case 'task_view_result':
      return handleTaskViewResult(chatId, payload.taskId, messenger)
  }
}

// ── Individual action handlers ──

async function handleApprovalAction(
  chatId: string,
  payload: Extract<CardActionPayload, { action: 'approve' | 'reject' }>,
  messenger: MessengerAdapter,
  onApprovalResult?: CardActionParams['onApprovalResult']
): Promise<void> {
  const approval: ParsedApproval = { action: payload.action, nodeId: payload.nodeId }
  const result = await handleApproval(approval, onApprovalResult)
  logger.info(`→ approval: ${approval.action} ${approval.nodeId ?? '(auto)'}`)
  await messenger.reply(chatId, result)
}

async function handleListPageAction(
  chatId: string,
  messageId: string | undefined,
  payload: Extract<CardActionPayload, { action: 'list_page' }>,
  messenger: MessengerAdapter
): Promise<unknown> {
  const page = parseInt(payload.page, 10) || 1
  const result = await handleList(payload.filter, page)

  if (result.larkCard && messageId) {
    // Update card in-place via API with small delay to prevent race conditions
    setTimeout(() => {
      messenger.editCard?.(chatId, messageId, result.larkCard!).then(
        () => logger.debug(`→ [card] update completed for page ${page}`),
        e => logger.error(`→ [card] update failed for page ${page}: ${e instanceof Error ? e.message : String(e)}`)
      )
    }, 100)
    // Return empty response to prevent SDK auto-handling
    return {}
  }

  await messenger.reply(chatId, result.text)
  return undefined
}

async function handleTaskDetailAction(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const result = await handleGet(taskId)
  if (result.larkCard) {
    await messenger.replyCard?.(chatId, result.larkCard)
  } else {
    await messenger.reply(chatId, result.text)
  }
}

async function handleTaskLogsAction(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const result = await handleLogs(taskId)
  if (result.larkCard) {
    await messenger.replyCard?.(chatId, result.larkCard)
  } else {
    await messenger.reply(chatId, result.text)
  }
}

async function handleTaskStopAction(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const result = await handleStop(taskId)
  await messenger.reply(chatId, result.text)
}

async function handleTaskRetryAction(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const result = await handleResume(taskId)
  await messenger.reply(chatId, result.text)
}

async function handleTaskPauseAction(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const result = await handlePause(taskId)
  if (result.larkCard) {
    await messenger.replyCard?.(chatId, result.larkCard)
  } else {
    await messenger.reply(chatId, result.text)
  }
}

async function handleTaskResumeAction(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const resumeResult = resumePausedTask(taskId)
  if (resumeResult.success) {
    logger.info(`→ task resumed via card: ${taskId.slice(0, 20)}`)
    await messenger.reply(chatId, `▶️ 已恢复任务: \`${taskId.slice(0, 20)}\``)
  } else {
    // Fallback to generic resume (may be an orphan, not paused)
    const result = await handleResume(taskId)
    await messenger.reply(chatId, result.text)
  }
}

async function handleTaskMsgPrompt(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  // Lark cards don't support inline text input, so prompt the user to send a /msg command
  await messenger.reply(chatId, `💬 请使用以下命令向任务发送消息:\n\n/msg ${taskId.slice(0, 12)} <你的消息>`)
}

async function handleTaskViewResult(
  chatId: string,
  taskId: string,
  messenger: MessengerAdapter
): Promise<void> {
  const summary = await readOutputSummary(taskId)

  if (!summary) {
    await messenger.reply(chatId, '📄 暂无输出结果')
    return
  }

  const shortId = taskId.replace(/^task-/, '').slice(0, 8)
  const elements = [
    mdElement(summary),
    noteElement(`任务 ID: ${taskId}`),
  ]

  const card = buildCard(`📄 结果摘要 ${shortId}`, 'blue', elements)
  await messenger.replyCard?.(chatId, card)
}
