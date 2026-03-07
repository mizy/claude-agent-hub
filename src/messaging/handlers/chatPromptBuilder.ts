/**
 * Chat prompt assembly — build full prompt with client context, memory, history, images, files
 */

import { loadConfig } from '../../config/loadConfig.js'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { buildClientPrompt, wrapMemoryContext, wrapHistoryContext, type PromptMode } from '../../prompts/chatPrompts.js'
import { getRecentConversations } from '../../store/conversationLog.js'
import { retrieveAllMemoryContext } from '../../memory/index.js'
import { isClaudeModelBackend, selectModel } from './selectModel.js'
import { getModelOverride } from './sessionManager.js'
import { buildFileInlineSection } from './chatInputParser.js'
import type { ClientContext } from './types.js'

const logger = createLogger('chat-prompt-builder')

/** Build full prompt: client context + memory + history + user text + images + files
 *  mode='minimal' skips agent, memory, and history — for subagent/task internal calls */
export async function buildFullPrompt(
  chatId: string,
  effectiveText: string,
  willStartNewSession: boolean,
  client: ClientContext | undefined,
  images: string[] | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>,
  runtime?: { backend?: string; model?: string },
  files?: string[],
  mode: PromptMode = 'full'
): Promise<string> {
  const clientPrefix = client ? buildClientPrompt(client, runtime, mode) + '\n\n' : ''

  // Inject recent history for new sessions (only in/out, deduplicated)
  // Skip in minimal mode
  let historyRaw = ''
  if (mode === 'full' && willStartNewSession) {
    const recent = getRecentConversations(chatId, 8)
      .filter(e => e.dir === 'in' || e.dir === 'out')
    if (recent.length > 0) {
      // Deduplicate consecutive entries with same dir+text
      const deduped = recent.filter((e, i) =>
        i === 0 || e.dir !== recent[i - 1]!.dir || e.text !== recent[i - 1]!.text
      )
      historyRaw = deduped
        .map(e => {
          const role = e.dir === 'in' ? '用户' : 'AI'
          const content = e.text.length > 400 ? e.text.slice(0, 397) + '...' : e.text
          return `[${role}] ${content}`
        })
        .join('\n')
    }
  }

  // Retrieve relevant memories for new sessions (skip in minimal mode)
  let memoryRaw = ''
  if (mode === 'full' && effectiveText && willStartNewSession) {
    try {
      const context = await retrieveAllMemoryContext(effectiveText, {
        maxResults: config.memory.chatMemory.maxMemories,
      })
      if (context) {
        memoryRaw = context
        logger.debug(`injected memory context (${context.length} chars) [${chatId.slice(0, 8)}]`)
      }
    } catch (e) {
      logger.debug(`memory retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Assemble: system context → memory → history → user message → images → files
  let prompt =
    clientPrefix + wrapMemoryContext(memoryRaw) + wrapHistoryContext(historyRaw) + effectiveText
  if (images?.length) {
    // Use →path← delimiters so ABSOLUTE_RE (lookbehind: \s|["'`(]) won't match
    // and imageExtractor won't re-send the user's original image in the response
    const imagePart = images
      .map(p => `[用户发送了图片，请使用 Read 工具查看后回复，路径→${p}←]`)
      .join('\n')
    prompt = prompt ? `${prompt}\n\n${imagePart}` : imagePart
  }
  if (files?.length) {
    const filePart = buildFileInlineSection(files)
    prompt = prompt ? `${prompt}\n\n${filePart}` : filePart
  }
  return prompt
}

/** Resolve model: inline keyword > session override > auto-select (Claude only) */
export function resolveModel(
  effectiveText: string,
  hasImages: boolean,
  inlineModel: string | undefined,
  chatId: string,
  backendOverride: string | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>
): string | undefined {
  const modelOverride = inlineModel ?? getModelOverride(chatId)
  const resolvedBackendType = backendOverride
    ? config.backends[backendOverride]?.type ?? backendOverride
    : config.backends[config.defaultBackend]?.type ?? 'claude-code'
  const isClaudeBackend = isClaudeModelBackend(resolvedBackendType)
  return modelOverride
    ? modelOverride
    : isClaudeBackend
      ? selectModel(effectiveText, { hasImages })
      : undefined
}
