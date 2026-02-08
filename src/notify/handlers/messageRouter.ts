/**
 * Unified message router — platform-agnostic command dispatch
 *
 * Consolidates the routing logic previously duplicated in larkWsClient.ts and telegramClient.ts.
 * Platforms provide a MessengerAdapter + context; the router handles all dispatch.
 */

import { parseApprovalCommand, handleApproval } from './approvalHandler.js'
import { handleCommand } from './commandHandler.js'
import { handleChat, clearChatSession, getChatSessionInfo } from './chatHandler.js'
import { APPROVAL_COMMANDS, TASK_COMMANDS } from './constants.js'
import type { MessengerAdapter, ParsedApproval, ClientContext } from './types.js'

// ── Command parsing ──

/**
 * Parse a slash command from text, handling @mention cleanup (Lark group chat).
 * Returns null if the text is not a slash command.
 */
export function parseCommandText(text: string): { cmd: string; args: string } | null {
  const clean = text.replace(/@[\w\u4e00-\u9fa5]+/g, '').trim()
  if (!clean.startsWith('/')) return null
  const spaceIdx = clean.indexOf(' ')
  if (spaceIdx === -1) return { cmd: clean.toLowerCase(), args: '' }
  return { cmd: clean.slice(0, spaceIdx).toLowerCase(), args: clean.slice(spaceIdx + 1).trim() }
}

// ── Router options ──

export interface RouteMessageOptions {
  chatId: string
  text: string
  messenger: MessengerAdapter
  clientContext: ClientContext
  /**
   * Called after a successful approval to send platform-specific notifications
   * (e.g. Lark webhook card, Telegram approval result message)
   */
  onApprovalResult?: (result: {
    nodeId: string
    nodeName: string
    approved: boolean
    reason?: string
  }) => Promise<void>
  /**
   * Whether to check non-command text for bare approval keywords (e.g. "通过", "ok").
   * Lark enables this (group chat users may reply without slash); Telegram skips it.
   */
  checkBareApproval?: boolean
}

// ── Core routing ──

/**
 * Route an incoming text message to the appropriate handler.
 *
 * Dispatch order:
 * 1. Slash commands: /new, /chat → session management
 * 2. Slash commands: approval set → approvalHandler
 * 3. Slash commands: task set → commandHandler
 * 4. Non-command: bare approval keywords (if checkBareApproval)
 * 5. Non-command: free chat → chatHandler
 */
export async function routeMessage(options: RouteMessageOptions): Promise<void> {
  const { chatId, text, messenger, clientContext, onApprovalResult, checkBareApproval } = options

  // Clean text (remove @mentions for matching)
  const cleanText = text.replace(/@[\w\u4e00-\u9fa5]+/g, '').trim()

  // Parse slash command
  const parsed = parseCommandText(text)

  if (parsed) {
    // Session commands
    if (parsed.cmd === '/new') {
      const cleared = clearChatSession(chatId)
      await messenger.reply(chatId, cleared ? '✅ 已开始新对话' : '当前没有活跃会话')
      return
    }
    if (parsed.cmd === '/chat') {
      const info = getChatSessionInfo(chatId)
      if (!info) {
        await messenger.reply(chatId, '当前没有活跃会话，直接发送文字即可开始对话')
      } else {
        const elapsed = Math.round((Date.now() - info.lastActiveAt) / 1000 / 60)
        await messenger.reply(
          chatId,
          `💬 会话 ${info.sessionId.slice(0, 12)}... | 活跃于 ${elapsed} 分钟前`
        )
      }
      return
    }

    // Approval slash commands
    if (APPROVAL_COMMANDS.has(parsed.cmd)) {
      const approval = parseApprovalCommand(cleanText)
      if (approval) {
        await handleApprovalAndReply(approval, chatId, messenger, onApprovalResult)
        return
      }
    }

    // Task management commands (prefer card when adapter supports it)
    if (TASK_COMMANDS.has(parsed.cmd)) {
      const cmdResult = await handleCommand(parsed.cmd, parsed.args)
      if (cmdResult.larkCard && messenger.replyCard) {
        await messenger.replyCard(chatId, cmdResult.larkCard)
      } else {
        await messenger.reply(chatId, cmdResult.text)
      }
      return
    }
  }

  // Non-command text: check bare approval keywords (Lark enables this)
  if (checkBareApproval) {
    const approval = parseApprovalCommand(cleanText)
    if (approval) {
      await handleApprovalAndReply(approval, chatId, messenger, onApprovalResult)
      return
    }
  }

  // Free chat
  await handleChat(chatId, cleanText, messenger, { client: clientContext })
}

// ── Helpers ──

async function handleApprovalAndReply(
  approval: ParsedApproval,
  chatId: string,
  messenger: MessengerAdapter,
  onApprovalResult?: RouteMessageOptions['onApprovalResult']
): Promise<void> {
  const result = await handleApproval(approval, onApprovalResult)
  await messenger.reply(chatId, result)
}
