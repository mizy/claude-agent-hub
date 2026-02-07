/**
 * 后端解析与注册
 *
 * 根据配置选择对应的 BackendAdapter 实例
 */

import { loadConfig } from '../config/loadConfig.js'
import type { BackendAdapter } from './types.js'
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

/** 缓存的后端实例 */
let cachedBackend: BackendAdapter | null = null

/**
 * 从配置解析后端
 * 结果在进程生命周期内缓存
 */
export async function resolveBackend(): Promise<BackendAdapter> {
  if (cachedBackend) return cachedBackend

  const config = await loadConfig()

  // 支持新旧配置格式（loadConfig 已做 claude → backend 映射）
  const backendType = config.backend?.type ?? 'claude-code'

  const factory = BACKEND_REGISTRY[backendType]
  if (!factory) {
    const available = Object.keys(BACKEND_REGISTRY).join(', ')
    throw new Error(`未知后端: ${backendType}，可用: ${available}`)
  }

  cachedBackend = factory()
  return cachedBackend
}

/** 注册自定义后端（用于扩展） */
export function registerBackend(name: string, factory: () => BackendAdapter): void {
  BACKEND_REGISTRY[name] = factory
}

/** 清除缓存（用于测试或配置重载） */
export function clearBackendCache(): void {
  cachedBackend = null
}

/** 获取所有已注册后端名称 */
export function getRegisteredBackends(): string[] {
  return Object.keys(BACKEND_REGISTRY)
}
