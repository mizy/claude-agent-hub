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
  registerBackend,
  clearBackendCache,
  getRegisteredBackends,
} from './resolveBackend.js'

export { buildPrompt } from './promptBuilder.js'

import { resolveBackend } from './resolveBackend.js'
import { acquireSlot, releaseSlot, getSlotInfo } from './concurrency.js'
import { buildPrompt } from './promptBuilder.js'
import { createLogger } from '../shared/logger.js'
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
 */
export async function invokeBackend(
  options: InvokeOptions
): Promise<Result<InvokeResult, InvokeError>> {
  const backend = await resolveBackend()

  // 组装完整 prompt（persona system prompt + mode 指令 + 用户 prompt）
  const fullPrompt = buildPrompt(options.prompt, options.persona, options.mode)
  const slots = getSlotInfo()

  logger.info(
    `[${options.mode ?? 'default'}] 调用 ${backend.displayName} (${fullPrompt.length} chars)` +
      `${options.sessionId ? ` [复用会话 ${options.sessionId.slice(0, 8)}]` : ''}` +
      ` [slots: ${slots.active}/${slots.max}]`
  )
  logger.debug(`Prompt: ${truncate(fullPrompt, 100)}`)

  await acquireSlot()
  try {
    const result = await backend.invoke({ ...options, prompt: fullPrompt })
    releaseSlot()
    return result
  } catch (error) {
    releaseSlot()
    throw error
  }
}

/**
 * 检查当前配置的后端是否可用
 */
export async function checkBackendAvailable(): Promise<boolean> {
  const backend = await resolveBackend()
  return backend.checkAvailable()
}
