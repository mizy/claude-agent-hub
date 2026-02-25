/**
 * 后端解析与注册
 *
 * 根据配置选择对应的 BackendAdapter 实例，支持动态切换
 */

import { loadConfig } from '../config/index.js'
import type { BackendAdapter } from './types.js'
import type { Task } from '../types/task.js'
import { createClaudeCodeBackend } from './claudeCodeBackend.js'
import { createOpencodeBackend } from './opencodeBackend.js'
import { createIflowBackend } from './iflowBackend.js'
import { createCodebuddyBackend } from './codebuddyBackend.js'

/** 后端工厂注册表 */
const BACKEND_REGISTRY: Record<string, () => BackendAdapter> = {
  'claude-code': createClaudeCodeBackend,
  opencode: createOpencodeBackend,
  iflow: createIflowBackend,
  codebuddy: createCodebuddyBackend,
}

/** 按 backend name 缓存实例 (name = backendType or 'default') */
const backendCache = new Map<string, BackendAdapter>()

/**
 * 从配置或指定类型解析后端
 *
 * 优先级：backendType 参数 > config.defaultBackend
 */
export async function resolveBackend(backendType?: string): Promise<BackendAdapter> {
  const config = await loadConfig()

  // Determine which backend to use
  const namedBackends = config.backends
  let resolvedType: string
  let backendName: string

  if (backendType && backendType !== 'default') {
    // Check named backends first, then treat as registry key
    if (namedBackends[backendType]) {
      resolvedType = namedBackends[backendType]!.type
      backendName = backendType
    } else {
      resolvedType = backendType
      backendName = backendType
    }
  } else {
    // Use defaultBackend
    backendName = config.defaultBackend
    if (!namedBackends[backendName]) {
      throw new Error(`defaultBackend "${backendName}" not found in backends config`)
    }
    resolvedType = namedBackends[backendName]!.type
  }

  // Cache key: use backendName
  const cacheKey = backendName

  // Return cached instance if available
  if (backendCache.has(cacheKey)) {
    return backendCache.get(cacheKey)!
  }

  const factory = BACKEND_REGISTRY[resolvedType]
  if (!factory) {
    const available = Object.keys(BACKEND_REGISTRY).join(', ')
    throw new Error(`未知后端: ${resolvedType}，可用: ${available}`)
  }

  const backend = factory()

  backendCache.set(cacheKey, backend)
  return backend
}

/**
 * 根据任务配置解析后端
 *
 * 优先级：task.backend > config.defaultBackend
 */
export async function resolveBackendForTask(task: Task): Promise<BackendAdapter> {
  return resolveBackend(task.backend)
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
