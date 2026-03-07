/**
 * Backend 配置解析
 *
 * 从 resolveBackend.ts 提取出来，解耦后端解析与配置
 */

import { loadConfig } from '../config/index.js'
import { backendConfigSchema, type BackendConfig } from '../config/schema.js'

/**
 * 解析任务指定的 backend 配置（用于获取 model 等详细配置）
 *
 * 优先级：
 * - named backend（在 config.backends 中有定义）→ 返回完整配置
 * - direct type（直接指定类型如 'iflow'）→ 返回仅含 type 的最小配置，不回退 defaultBackend.model
 * - 无指定 → 使用 defaultBackend
 */
export async function resolveBackendConfig(backendType?: string): Promise<BackendConfig> {
  const config = await loadConfig()
  const namedBackends = config.backends

  if (backendType) {
    // Named backend: return full config including model
    if (namedBackends[backendType]) {
      return namedBackends[backendType]!
    }
    // Direct type: return minimal config from schema defaults, no model fallback from defaultBackend
    return backendConfigSchema.parse({ type: backendType, model: '' })
  }

  // No backendType specified: use defaultBackend
  const defaultName = config.defaultBackend
  if (namedBackends[defaultName]) {
    return namedBackends[defaultName]!
  }
  throw new Error(`defaultBackend "${defaultName}" not found in backends config`)
}
