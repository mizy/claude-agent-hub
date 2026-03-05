/**
 * Unified message router — platform-agnostic command dispatch
 *
 * Consolidates the routing logic previously duplicated in larkWsClient.ts and telegramClient.ts.
 * Platforms provide a MessengerAdapter + context; the router handles all dispatch.
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { parseApprovalCommand, handleApproval } from './approvalHandler.js'
import { handleCommand } from './commandHandler.js'
import { handleChat, clearChatSession, getChatSessionInfo, toggleBenchmark } from './chatHandler.js'
import { setModelOverride, getModelOverride, setBackendOverride, getBackendOverride } from './sessionManager.js'
import { triggerEpisodeOnTaskCreation } from './episodeExtractor.js'
import { APPROVAL_COMMANDS, TASK_COMMANDS } from './constants.js'
import { getRegisteredBackends } from '../../backend/resolveBackend.js'
import type { MessengerAdapter, ParsedApproval, ClientContext } from './types.js'

const logger = createLogger('message-router')

// ── Command parsing ──

/**
 * Parse a slash command from text, handling @mention cleanup (Lark group chat).
 * Returns null if the text is not a slash command.
 */
export function parseCommandText(text: string): { cmd: string; args: string } | null {
  const clean = text.replace(/@\S+/g, '').trim()
  if (!clean.startsWith('/')) return null
  const spaceIdx = clean.indexOf(' ')
  if (spaceIdx === -1) return { cmd: clean.toLowerCase(), args: '' }
  return { cmd: clean.slice(0, spaceIdx).toLowerCase(), args: clean.slice(spaceIdx + 1).trim() }
}

// ── Router options ──

export interface RouteMessageOptions {
  chatId: string
  text: string
  /** Optional image file paths (e.g. downloaded from Lark) */
  images?: string[]
  /** Optional non-image file paths (e.g. PDF, txt, xlsx sent by user) */
  files?: string[]
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
  const { chatId, text, images, files, messenger, clientContext, onApprovalResult, checkBareApproval } = options

  // Clean text (remove @mentions for matching)
  const cleanText = text.replace(/@\S+/g, '').trim()

  // Parse slash command
  const parsed = parseCommandText(text)

  if (parsed) {
    // Session commands
    if (parsed.cmd === '/benchmark') {
      const enabled = toggleBenchmark()
      await messenger.reply(chatId, enabled ? '📊 Benchmark 已开启，每次对话后会显示耗时分解' : '📊 Benchmark 已关闭')
      return
    }
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
    if (parsed.cmd === '/model') {
      await handleModelCommand(chatId, parsed.args, messenger)
      return
    }
    if (parsed.cmd === '/backend') {
      await handleBackendCommand(chatId, parsed.args, messenger)
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
      try {
        const cmdResult = await handleCommand(parsed.cmd, parsed.args)
        logger.debug(`handleCommand result for ${parsed.cmd}: ${JSON.stringify(cmdResult).slice(0, 200)}`)
        if (cmdResult.larkCard && messenger.replyCard) {
          logger.debug('Sending lark card')
          await messenger.replyCard(chatId, cmdResult.larkCard)
        } else {
          logger.debug(`Sending text reply: ${cmdResult.text?.slice(0, 50)}`)
          await messenger.reply(chatId, cmdResult.text)
        }
        // Trigger episode extraction when a task is created from chat
        if (parsed.cmd === '/run') {
          triggerEpisodeOnTaskCreation(chatId)
        }
      } catch (error) {
        const msg = getErrorMessage(error)
        logger.error(`Command ${parsed.cmd} failed: ${msg}`)
        await messenger.reply(chatId, `❌ 命令执行失败: ${msg}`)
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

  // Free chat (pass original text — chatHandler.parseBackendOverride needs @prefix intact)
  await handleChat(chatId, text, messenger, { client: clientContext, images, files })
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

const VALID_MODELS = new Set(['opus', 'sonnet', 'haiku'])

async function handleModelCommand(chatId: string, args: string, messenger: MessengerAdapter): Promise<void> {
  const arg = args.trim().toLowerCase()

  // No argument: show current setting
  if (!arg) {
    const current = getModelOverride(chatId)
    await messenger.reply(chatId, current ? `🤖 当前模型: ${current} (手动)` : '🤖 当前模型: auto (自动选择)')
    return
  }

  // /model auto — restore automatic selection
  if (arg === 'auto') {
    setModelOverride(chatId, undefined)
    await messenger.reply(chatId, '🤖 已恢复自动模型选择')
    return
  }

  // /model <name> — set override
  if (VALID_MODELS.has(arg)) {
    setModelOverride(chatId, arg)
    await messenger.reply(chatId, `🤖 模型已切换为 ${arg}，会话期间生效`)
    return
  }

  await messenger.reply(chatId, '用法: /model [opus|sonnet|haiku|auto]')
}

async function handleBackendCommand(chatId: string, args: string, messenger: MessengerAdapter): Promise<void> {
  const arg = args.trim().toLowerCase()
  const backends = getRegisteredBackends()

  // No argument: show current setting
  if (!arg) {
    const current = getBackendOverride(chatId)
    await messenger.reply(chatId, current ? `🔧 当前后端: ${current} (手动)` : '🔧 当前后端: auto (使用配置默认值)')
    return
  }

  // /backend auto — restore default
  if (arg === 'auto') {
    setBackendOverride(chatId, undefined)
    await messenger.reply(chatId, '🔧 已恢复默认后端')
    return
  }

  // /backend <name> — set override
  if (backends.includes(arg)) {
    setBackendOverride(chatId, arg)
    await messenger.reply(chatId, `🔧 后端已切换为 ${arg}，会话期间生效`)
    return
  }

  await messenger.reply(chatId, `用法: /backend [${backends.join('|')}|auto]`)
}
