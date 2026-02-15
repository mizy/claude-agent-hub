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

/** 后端工厂注册表 */
const BACKEND_REGISTRY: Record<string, () => BackendAdapter> = {
  'claude-code': createClaudeCodeBackend,
  opencode: createOpencodeBackend,
  iflow: createIflowBackend,
  codebuddy: createCodebuddyBackend,
}

/** 按 backend type 缓存实例 */
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
  if (backendType) {
    // Check named backends first, then treat as registry key
    resolvedType = namedBackends[backendType]?.type ?? backendType
  } else if (config.defaultBackend && namedBackends[config.defaultBackend]) {
    resolvedType = namedBackends[config.defaultBackend]!.type
  } else {
    resolvedType = config.backend.type
  }

  // Return cached instance if available
  if (backendCache.has(resolvedType)) {
    return backendCache.get(resolvedType)!
  }

  const factory = BACKEND_REGISTRY[resolvedType]
  if (!factory) {
    const available = Object.keys(BACKEND_REGISTRY).join(', ')
    throw new Error(`未知后端: ${resolvedType}，可用: ${available}`)
  }

  const backend = factory()
  backendCache.set(resolvedType, backend)
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
