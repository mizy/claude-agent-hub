/**
 * 后端解析与注册
 *
 * 根据配置选择对应的 BackendAdapter 实例，支持动态切换
 */

import { loadConfig } from '../config/index.js'
import type { BackendConfig } from '../config/schema.js'
import type { BackendAdapter } from './types.js'
import type { Task } from '../types/task.js'
import { createClaudeCodeBackend } from './claudeCodeBackend.js'
import { createOpencodeBackend } from './opencodeBackend.js'
import { createIflowBackend } from './iflowBackend.js'
import { createCodebuddyBackend } from './codebuddyBackend.js'
import { createOpenAICompatibleBackend } from './openaiCompatibleBackend.js'

/** 后端工厂注册表 */
const BACKEND_REGISTRY: Record<string, () => BackendAdapter> = {
  'claude-code': createClaudeCodeBackend,
  opencode: createOpencodeBackend,
  iflow: createIflowBackend,
  codebuddy: createCodebuddyBackend,
  openai: createOpenAICompatibleBackend,
}

/** 按 backend name 缓存实例 (name = backendType or 'default') */
const backendCache = new Map<string, BackendAdapter>()

/**
 * 从配置或指定类型解析后端
 *
 * 优先级：backendType 参数 > config.defaultBackend > config.backend.type
 */
export async function resolveBackend(backendType?: string): Promise<BackendAdapter> {
  const config = await loadConfig()

  // Determine which backend type to use
  const namedBackends = config.backends ?? {}
  let resolvedType: string
  let backendName: string | undefined

  if (backendType && backendType !== 'default') {
    // Check named backends first, then treat as registry key
    if (namedBackends[backendType]) {
      resolvedType = namedBackends[backendType]!.type
      backendName = backendType
    } else {
      resolvedType = backendType
    }
  } else if (config.defaultBackend && namedBackends[config.defaultBackend]) {
    resolvedType = namedBackends[config.defaultBackend]!.type
    backendName = config.defaultBackend
  } else {
    resolvedType = config.backend.type
  }

  // Cache key: use backendName if named backend, else resolvedType
  const cacheKey = backendName ?? resolvedType

  // Return cached instance if available
  if (backendCache.has(cacheKey)) {
    return backendCache.get(cacheKey)!
  }

  // Auto-route to openai-compatible backend when openaiCompatible is configured
  // This allows any backend type (e.g. opencode) to switch to API mode
  const backendConfig = backendName
    ? (config.backends ?? {})[backendName]
    : config.backend
  const useOpenAI = resolvedType !== 'openai' && backendConfig?.openaiCompatible != null

  const effectiveType = useOpenAI ? 'openai' : resolvedType

  const factory = BACKEND_REGISTRY[effectiveType]
  if (!factory) {
    const available = Object.keys(BACKEND_REGISTRY).join(', ')
    throw new Error(`未知后端: ${resolvedType}，可用: ${available}`)
  }

  // For openai backend (explicit or auto-routed), pass backendName so it can resolve correct config
  const backend = effectiveType === 'openai'
    ? (factory as (name?: string) => BackendAdapter)(backendName)
    : factory()

  backendCache.set(cacheKey, backend)
  return backend
}

/**
 * 根据任务配置解析后端
 *
 * 优先级：task.backend > config.defaultBackend > config.backend.type
 */
export async function resolveBackendForTask(task: Task): Promise<BackendAdapter> {
  return resolveBackend(task.backend)
}

/**
 * 解析任务指定的 backend 配置（用于获取 model 等详细配置）
 *
 * 优先级：task.backend (named) > config.defaultBackend (named) > config.backend
 */
export async function resolveBackendConfig(backendType?: string): Promise<BackendConfig> {
  const config = await loadConfig()
  const namedBackends = config.backends ?? {}

  if (backendType && namedBackends[backendType]) {
    return namedBackends[backendType]!
  }
  if (config.defaultBackend && namedBackends[config.defaultBackend]) {
    return namedBackends[config.defaultBackend]!
  }
  return config.backend
}

/** 注册自定义后端（用于扩展） */
export function registerBackend(name: string, factory: () => BackendAdapter): void {
  BACKEND_REGISTRY[name] = factory
}

/** 清除缓存（用于测试或配置重载） */
export function clearBackendCache(): void {
  backendCache.clear()
}

/** 获取所有已注册后端名称 */
export function getRegisteredBackends(): string[] {
  return Object.keys(BACKEND_REGISTRY)
}
