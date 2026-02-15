/**
 * @entry Config 配置模块
 *
 * 加载 YAML 配置、Schema 校验、项目初始化
 */

export {
  loadConfig,
  getDefaultConfig,
  clearConfigCache,
  stopConfigWatch,
  applyEnvOverrides,
} from './loadConfig.js'
export { initProject } from './initProject.js'
export * from './schema.js'

import { loadConfig } from './loadConfig.js'
import type { NotifyConfig, LarkConfig, BackendConfig, TaskConfig } from './schema.js'

/** Get notify sub-config (lark + telegram), undefined if not configured */
export async function getNotifyConfig(): Promise<NotifyConfig | undefined> {
  const config = await loadConfig()
  return config.notify
}

/** Get lark sub-config, undefined if not configured */
export async function getLarkConfig(): Promise<LarkConfig | undefined> {
  const config = await loadConfig()
  return config.notify?.lark
}

/** Get effective backend config, respecting defaultBackend and named backends */
export async function getBackendConfig(): Promise<BackendConfig> {
  const config = await loadConfig()
  const namedBackends = config.backends ?? {}
  if (config.defaultBackend && namedBackends[config.defaultBackend]) {
    return namedBackends[config.defaultBackend]!
  }
  return config.backend
}

/** Get task config (always has defaults) */
export async function getTaskConfig(): Promise<TaskConfig> {
  const config = await loadConfig()
  return config.tasks
}
