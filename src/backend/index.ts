/**
 * @entry Backend 模块 - CLI 后端抽象层
 *
 * 能力分组：
 * - 调用: invokeBackend()（自动限流、prompt 组装、Span 追踪）
 * - 检测: checkBackendAvailable()
 * - 轻量模型: resolveLightModel()（为简单任务选择轻量模型）
 * - 注册: resolveBackend/resolveBackendForTask/registerBackend/clearBackendCache/getRegisteredBackends
 * - 配置: resolveBackendConfig()（独立于 resolveBackend 的配置解析，避免循环依赖）
 * - Prompt: buildPrompt()（agent system prompt + mode 指令 + 用户 prompt 组装）
 *
 * 支持的后端：
 * - claude-code: Claude Code CLI (默认)
 * - opencode: OpenCode CLI (75+ 模型，含免费 Zen 模型)
 * - iflow: iflow-cli (Qwen3-Coder, DeepSeek 等免费模型)
 * - codebuddy: Codebuddy CLI
 * - cursor: Cursor IDE 后端
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

export { buildPrompt, type BuiltPrompt } from './promptBuilder.js'

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

/**
 * 调用当前配置的 CLI 后端
 * 自动处理：限流、prompt 组装（agent + mode）、日志
 *
 * 支持通过 backendType/backendModel 动态覆盖后端和模型
 */
export async function invokeBackend(
  options: InvokeOptions & { backendType?: string; backendModel?: string }
): Promise<Result<InvokeResult, InvokeError>> {
  const backend = await resolveBackend(options.backendType)

  // Resolve model without mutating the caller's options object
  let resolvedModel = options.model
  if (!resolvedModel && options.backendModel) {
    resolvedModel = options.backendModel
  }
  if (!resolvedModel) {
    const backendConfig = await resolveBackendConfig(options.backendType)
    if (backendConfig.model) {
      resolvedModel = backendConfig.model
    }
  }

  // 组装 prompt：agent/mode → systemPrompt，用户内容 → userPrompt
  const built = buildPrompt(options.prompt, options.agent, options.mode)
  // Merge: caller's systemPrompt (e.g. clientPrefix+consciousness) + agent/mode systemPrompt
  const mergedSystemPrompt = [options.systemPrompt, built.systemPrompt].filter(Boolean).join('\n\n')
  const userPrompt = built.userPrompt
  const totalLength = mergedSystemPrompt.length + userPrompt.length
  const slots = getSlotInfo()

  logger.info(
    `[${options.mode ?? 'default'}] 调用 ${backend.displayName} (${totalLength} chars, sys:${mergedSystemPrompt.length})` +
      `${options.sessionId ? ` [复用会话 ${options.sessionId.slice(0, 8)}]` : ''}` +
      ` [slots: ${slots.active}/${slots.max}]`
  )
  logger.debug(`Prompt prepared: sys=${mergedSystemPrompt.length} user=${userPrompt.length} chars`)

  // Check if already aborted before waiting for a slot
  if (options.signal?.aborted) {
    return {
      ok: false,
      error: { type: 'cancelled', message: 'Aborted before slot acquisition' },
    } as Result<InvokeResult, InvokeError>
  }

  const slotStart = Date.now()
  let slotWaitMs = 0
  try {
    await acquireSlot(options.signal)
  } catch (e) {
    // AbortError from signal — slot was never acquired, no need to release
    if (e instanceof DOMException && e.name === 'AbortError') {
      return {
        ok: false,
        error: { type: 'cancelled', message: 'Aborted during slot wait' },
      } as Result<InvokeResult, InvokeError>
    }
    throw e
  }
  slotWaitMs = Date.now() - slotStart
  if (slotWaitMs > 50) {
    logger.info(`Slot wait: ${slotWaitMs}ms`)
  }

  // Create LLM span if trace context is provided
  const traceCtx = options.traceCtx
  const llmSpan = traceCtx
    ? createChildSpan(traceCtx.currentSpan, `llm:${resolvedModel ?? 'default'}`, 'llm', {
        'task.id': traceCtx.taskId,
        'llm.backend': backend.name,
        'llm.model': resolvedModel,
        'llm.prompt_length': totalLength,
        'llm.slot_wait_ms': slotWaitMs,
      })
    : undefined
  if (llmSpan && traceCtx) {
    appendSpan(traceCtx.taskId, llmSpan)
  }

  try {
    const result = await backend.invoke({
      ...options,
      prompt: userPrompt,
      systemPrompt: mergedSystemPrompt || undefined,
      model: resolvedModel,
    })
    releaseSlot()
    // Attach slot wait time to result
    if (result.ok) {
      result.value.slotWaitMs = slotWaitMs
    }

    // End LLM span with result data
    if (llmSpan && traceCtx) {
      const finished = endSpan(
        llmSpan,
        result.ok
          ? undefined
          : {
              error: { message: result.error.message },
            }
      )
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
 * Resolve a lightweight model for simple tasks (summarization, memory extraction, etc.)
 * Returns 'haiku' for claude-code backend, undefined (use default) for others.
 */
export async function resolveLightModel(backendType?: string): Promise<string | undefined> {
  const backend = await resolveBackend(backendType)
  if (backend.name === 'claude-code') return 'haiku'
  return undefined
}

/**
 * 检查当前配置的后端是否可用
 */
export async function checkBackendAvailable(): Promise<boolean> {
  const backend = await resolveBackend()
  return backend.checkAvailable()
}
