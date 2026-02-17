/**
 * @entry Backend 模块 - CLI 后端抽象层
 *
 * 核心能力：
 * - invokeBackend(): 调用当前配置的 CLI 后端
 * - checkBackendAvailable(): 检查后端是否可用
 * - resolveBackend(): 获取后端实例
 * - registerBackend(): 注册自定义后端
 *
 * 支持的后端：
 * - claude-code: Claude Code CLI (默认)
 * - opencode: OpenCode CLI (75+ 模型，含免费 Zen 模型)
 * - iflow: iflow-cli (Qwen3-Coder, DeepSeek 等免费模型)
 * - openai: OpenAI 兼容 API (LM Studio, Ollama, vLLM 等)
 */

export type {
  InvokeOptions,
  InvokeResult,
  InvokeError,
  BackendAdapter,
  BackendCapabilities,
} from './types.js'

export {
  resolveBackend,
  resolveBackendForTask,
  registerBackend,
  clearBackendCache,
  getRegisteredBackends,
} from './resolveBackend.js'

export { resolveBackendConfig } from './backendConfig.js'

export { buildPrompt } from './promptBuilder.js'
export { createOpenAICompatibleBackend } from './openaiCompatibleBackend.js'

import { resolveBackend } from './resolveBackend.js'
import { resolveBackendConfig } from './backendConfig.js'
import { acquireSlot, releaseSlot, getSlotInfo } from './concurrency.js'
import { buildPrompt } from './promptBuilder.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createChildSpan, endSpan } from '../store/createSpan.js'
import { appendSpan } from '../store/TraceStore.js'
import type { InvokeOptions, InvokeResult, InvokeError } from './types.js'
import type { Result } from '../shared/result.js'

const logger = createLogger('backend')

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim()
  return oneLine.length <= maxLen ? oneLine : oneLine.slice(0, maxLen) + '...'
}

/**
 * 调用当前配置的 CLI 后端
 * 自动处理：限流、prompt 组装（persona + mode）、日志
 *
 * 支持通过 backendType/backendModel 动态覆盖后端和模型
 */
export async function invokeBackend(
  options: InvokeOptions & { backendType?: string; backendModel?: string }
): Promise<Result<InvokeResult, InvokeError>> {
  const backend = await resolveBackend(options.backendType)

  // Apply model override: backendModel param > options.model > backend config model
  if (options.backendModel && !options.model) {
    options.model = options.backendModel
  }
  if (!options.model) {
    const backendConfig = await resolveBackendConfig(options.backendType)
    if (backendConfig.model) {
      options.model = backendConfig.model
    }
  }

  // 组装完整 prompt（persona system prompt + mode 指令 + 用户 prompt）
  const fullPrompt = buildPrompt(options.prompt, options.persona, options.mode)
  const slots = getSlotInfo()

  logger.info(
    `[${options.mode ?? 'default'}] 调用 ${backend.displayName} (${fullPrompt.length} chars)` +
      `${options.sessionId ? ` [复用会话 ${options.sessionId.slice(0, 8)}]` : ''}` +
      ` [slots: ${slots.active}/${slots.max}]`
  )
  logger.debug(`Prompt: ${truncate(fullPrompt, 100)}`)

  // Check if already aborted before waiting for a slot
  if (options.signal?.aborted) {
    return { ok: false, error: { type: 'cancelled', message: 'Aborted before slot acquisition' } } as Result<InvokeResult, InvokeError>
  }

  const slotStart = Date.now()
  await acquireSlot()
  const slotWaitMs = Date.now() - slotStart

  // Check if aborted while waiting for slot
  if (options.signal?.aborted) {
    releaseSlot()
    return { ok: false, error: { type: 'cancelled', message: 'Aborted during slot wait' } } as Result<InvokeResult, InvokeError>
  }
  if (slotWaitMs > 50) {
    logger.info(`Slot wait: ${slotWaitMs}ms`)
  }

  // Create LLM span if trace context is provided
  const traceCtx = options.traceCtx
  const llmSpan = traceCtx
    ? createChildSpan(traceCtx.currentSpan, `llm:${options.model ?? 'default'}`, 'llm', {
        'task.id': traceCtx.taskId,
        'llm.backend': backend.name,
        'llm.model': options.model,
        'llm.prompt_length': fullPrompt.length,
        'llm.slot_wait_ms': slotWaitMs,
      })
    : undefined
  if (llmSpan && traceCtx) {
    appendSpan(traceCtx.taskId, llmSpan)
  }

  try {
    const result = await backend.invoke({ ...options, prompt: fullPrompt })
    releaseSlot()
    // Attach slot wait time to result
    if (result.ok) {
      result.value.slotWaitMs = slotWaitMs
    }

    // End LLM span with result data
    if (llmSpan && traceCtx) {
      const finished = endSpan(llmSpan, result.ok ? undefined : {
        error: { message: result.error.message },
      })
      if (result.ok) {
        finished.attributes['llm.response_length'] = result.value.response.length
        finished.attributes['llm.duration_api_ms'] = result.value.durationApiMs
        finished.attributes['llm.session_id'] = result.value.sessionId
        if (result.value.costUsd != null) {
          finished.cost = { amount: result.value.costUsd, currency: 'USD' }
        }
      }
      appendSpan(traceCtx.taskId, finished)
    }

    return result
  } catch (error) {
    releaseSlot()

    // End LLM span with error
    if (llmSpan && traceCtx) {
      const finished = endSpan(llmSpan, {
        error: { message: getErrorMessage(error) },
      })
      appendSpan(traceCtx.taskId, finished)
    }

    const msg = getErrorMessage(error)
    logger.error(`Backend ${backend.displayName} threw: ${msg}`)
    throw new Error(`Backend ${backend.displayName} error: ${msg}`, { cause: error })
  }
}

/**
 * 检查当前配置的后端是否可用
 */
export async function checkBackendAvailable(): Promise<boolean> {
  const backend = await resolveBackend()
  return backend.checkAvailable()
}
