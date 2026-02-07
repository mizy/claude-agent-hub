/**
 * 平台无关的对话处理器
 * 将文本消息转发给 AI 后端，支持会话复用和流式响应
 */

import { invokeBackend } from '../../backend/index.js'
import { createLogger } from '../../shared/logger.js'
import { buildClientPrompt } from '../../prompts/chatPrompts.js'
import type { MessengerAdapter, ChatSession, ClientContext } from './types.js'

const logger = createLogger('chat-handler')

const DEFAULT_MAX_LENGTH = 4096
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const STREAM_THROTTLE_MS = 1500
const STREAM_MIN_DELTA = 100 // chars

const sessions = new Map<string, ChatSession>()

// 定期清理过期会话
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [chatId, session] of sessions) {
      if (now - session.lastActiveAt > SESSION_TIMEOUT_MS) {
        sessions.delete(chatId)
        logger.info(`Session expired for chat ${chatId}`)
      }
    }
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer)
      cleanupTimer = null
    }
  }, 60_000)
}

/** 分段发送长消息 */
function splitMessage(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text]
  const parts: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining)
      break
    }
    // 尝试在换行处断开
    let cutAt = remaining.lastIndexOf('\n', maxLength)
    if (cutAt < maxLength * 0.3) {
      // 换行太靠前，直接截断
      cutAt = maxLength
    }
    parts.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt)
  }
  return parts
}

export interface ChatOptions {
  /** 单条消息最大长度，默认 4096（Telegram 限制） */
  maxMessageLength?: number
  /** 客户端环境上下文，注入给 AI 让它知道回复格式约束 */
  client?: ClientContext
}


/**
 * 处理普通文本消息，调用 AI 后端获取回复
 */
export async function handleChat(
  chatId: string,
  text: string,
  messenger: MessengerAdapter,
  options?: ChatOptions,
): Promise<void> {
  const maxLen = options?.maxMessageLength ?? DEFAULT_MAX_LENGTH

  // 获取或创建会话
  const session = sessions.get(chatId)
  const sessionId = session?.sessionId

  // 发送占位消息
  const placeholderId = await messenger.sendAndGetId(chatId, '🤔 思考中...')

  let lastEditAt = 0
  let lastEditLength = 0
  let accumulated = ''

  const onChunk = placeholderId
    ? (chunk: string) => {
        accumulated += chunk
        const now = Date.now()
        const deltaLen = accumulated.length - lastEditLength
        // 节流：1.5s 间隔 + 100 字符增量
        if (now - lastEditAt > STREAM_THROTTLE_MS && deltaLen > STREAM_MIN_DELTA) {
          lastEditAt = now
          lastEditLength = accumulated.length
          const preview = accumulated.length > maxLen
            ? accumulated.slice(0, maxLen - 20) + '\n\n... (输出中)'
            : accumulated
          messenger.editMessage(chatId, placeholderId, preview).catch(() => {})
        }
      }
    : undefined

  // 首次对话注入客户端环境上下文
  const clientPrefix = options?.client && !sessionId
    ? buildClientPrompt(options.client) + '\n\n'
    : ''

  try {
    const result = await invokeBackend({
      prompt: clientPrefix + text,
      stream: true,
      skipPermissions: true,
      sessionId,
      onChunk,
    })

    if (!result.ok) {
      const errorMsg = `❌ AI 调用失败: ${result.error.message}`
      if (placeholderId) {
        await messenger.editMessage(chatId, placeholderId, errorMsg)
      } else {
        await messenger.reply(chatId, errorMsg)
      }
      return
    }

    const response = result.value.response
    const newSessionId = result.value.sessionId

    // 更新会话
    if (newSessionId) {
      sessions.set(chatId, { sessionId: newSessionId, lastActiveAt: Date.now() })
      ensureCleanupTimer()
    }

    // 发送最终回复
    const parts = splitMessage(response, maxLen)
    if (placeholderId && parts.length > 0) {
      // 用完整回复替换占位消息
      await messenger.editMessage(chatId, placeholderId, parts[0]!)
      // 剩余部分单独发送
      for (const part of parts.slice(1)) {
        await messenger.reply(chatId, part)
      }
    } else {
      for (const part of parts) {
        await messenger.reply(chatId, part)
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Chat handler error: ${msg}`)
    const errorMsg = `❌ 处理失败: ${msg}`
    if (placeholderId) {
      await messenger.editMessage(chatId, placeholderId, errorMsg).catch(() => {})
    } else {
      await messenger.reply(chatId, errorMsg)
    }
  }
}

/**
 * 清除指定聊天的会话
 */
export function clearChatSession(chatId: string): boolean {
  return sessions.delete(chatId)
}

/**
 * 获取指定聊天的会话信息
 */
export function getChatSessionInfo(chatId: string): ChatSession | undefined {
  return sessions.get(chatId)
}
