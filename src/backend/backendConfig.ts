/**
 * Backend 配置解析
 *
 * 从 resolveBackend.ts 提取出来，避免 openaiCompatibleBackend ↔ resolveBackend 循环依赖
 */

import { loadConfig } from '../config/index.js'
import type { BackendConfig } from '../config/schema.js'

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
