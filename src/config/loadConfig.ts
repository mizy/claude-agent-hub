import { readFile } from 'fs/promises'
import { existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { configSchema, type Config, type BackendConfig } from './schema.js'

const logger = createLogger('config')

const CONFIG_FILENAME = '.claude-agent-hub.yaml'

let cachedConfig: Config | null = null
let configWatcher: FSWatcher | null = null
let watchedPath: string | null = null
let reloadTimer: NodeJS.Timeout | null = null

/**
 * 查找配置文件路径（全局 + 项目）
 * 全局配置为基底，项目配置覆盖其上
 */
function findConfigPaths(cwd?: string): { globalPath: string | null; projectPath: string | null } {
  const homePath = join(homedir(), CONFIG_FILENAME)
  const projectDir = cwd || process.cwd()
  const projectPath = join(projectDir, CONFIG_FILENAME)

  // 项目目录与 home 目录相同时，不重复加载
  const isHomeCwd = projectDir === homedir()

  return {
    globalPath: existsSync(homePath) ? homePath : null,
    projectPath: !isHomeCwd && existsSync(projectPath) ? projectPath : null,
  }
}

/**
 * 加载项目配置
 * 查找顺序：项目目录 → ~/.claude-agent-hub.yaml → 默认配置
 * @param options - 配置选项或 cwd 字符串（向后兼容）
 * @param options.cwd - 工作目录
 * @param options.watch - 是否监听配置文件变化（daemon 模式推荐开启）
 */
export async function loadConfig(
  options?: { cwd?: string; watch?: boolean } | string
): Promise<Config> {
  // 向后兼容：支持直接传 cwd 字符串
  const { cwd, watch: enableWatch = false } =
    typeof options === 'string' ? { cwd: options, watch: false } : options || {}

  // Return cache if available (watch mode only affects watcher setup, not cache)
  if (cachedConfig) {
    if (enableWatch && !configWatcher) {
      const { projectPath, globalPath } = findConfigPaths(cwd)
      const watchPath = projectPath ?? globalPath
      if (watchPath) startWatching(watchPath)
    }
    return cachedConfig
  }

  const { globalPath, projectPath } = findConfigPaths(cwd)

  if (!globalPath && !projectPath) {
    const config = applyEnvOverrides(getDefaultConfig())
    cachedConfig = config
    return config
  }

  // Load global as base, merge project on top
  const globalRaw = globalPath ? await parseYamlFile(globalPath) : {}
  const projectRaw = projectPath ? await parseYamlFile(projectPath) : {}
  const merged = deepMergeConfig(globalRaw, projectRaw)

  const result = configSchema.safeParse(merged)
  if (!result.success) {
    logger.warn('Config file format error, using defaults', result.error.issues)
    cachedConfig = applyEnvOverrides(getDefaultConfig())
    return cachedConfig
  }

  cachedConfig = applyEnvOverrides(result.data)

  // Watch project config if it exists, otherwise watch global
  if (enableWatch && !configWatcher) {
    const watchPath = projectPath ?? globalPath
    if (watchPath) startWatching(watchPath)
  }

  return cachedConfig
}

/**
 * Parse YAML file, returning empty object for empty/comment-only/null files.
 * YAML.parse returns null for empty strings, so we normalize to {}.
 */
async function parseYamlFile(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf-8')
  const parsed = YAML.parse(content)
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

/**
 * Shallow-merge config objects: project fields override global fields.
 * Arrays and nested objects are replaced, not deep-merged.
 */
function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const val = override[key]
    if (val !== undefined && val !== null) {
      if (
        typeof val === 'object' &&
        !Array.isArray(val) &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMergeConfig(
          result[key] as Record<string, unknown>,
          val as Record<string, unknown>
        )
      } else {
        result[key] = val
      }
    }
  }
  return result
}

/**
 * 从文件加载并解析配置（用于 watch reload）
 * Re-merges global + project configs, same as initial load.
 */
async function reloadConfig(): Promise<Config> {
  const { globalPath, projectPath } = findConfigPaths()
  const globalRaw = globalPath ? await parseYamlFile(globalPath) : {}
  const projectRaw = projectPath ? await parseYamlFile(projectPath) : {}
  const merged = deepMergeConfig(globalRaw, projectRaw)

  const result = configSchema.safeParse(merged)
  if (!result.success) {
    logger.warn('Config file format error, using defaults', result.error.issues)
    return applyEnvOverrides(getDefaultConfig())
  }
  return applyEnvOverrides(result.data)
}

/**
 * Apply environment variable overrides to config.
 * Called after schema validation — env vars skip schema checks.
 */
export function applyEnvOverrides(config: Config): Config {
  const env = process.env

  // Notify: Lark
  if (env.CAH_LARK_APP_ID || env.CAH_LARK_APP_SECRET || env.CAH_LARK_WEBHOOK_URL) {
    const lark = config.notify?.lark ?? { appId: '', appSecret: '' }
    if (env.CAH_LARK_APP_ID) lark.appId = env.CAH_LARK_APP_ID
    if (env.CAH_LARK_APP_SECRET) lark.appSecret = env.CAH_LARK_APP_SECRET
    if (env.CAH_LARK_WEBHOOK_URL) lark.webhookUrl = env.CAH_LARK_WEBHOOK_URL
    config = { ...config, notify: { ...config.notify, lark } }
  }

  // Notify: Telegram
  if (env.CAH_TELEGRAM_BOT_TOKEN) {
    const telegram = config.notify?.telegram ?? { botToken: '' }
    telegram.botToken = env.CAH_TELEGRAM_BOT_TOKEN
    config = { ...config, notify: { ...config.notify, telegram } }
  }

  // Backend: ensure defaultBackend exists, then apply env overrides
  if (env.CAH_BACKEND_TYPE || env.CAH_BACKEND_MODEL || !config.backends[config.defaultBackend]) {
    const defaultBackendName = config.defaultBackend
    const backends = { ...config.backends }
    const defaultBackend: BackendConfig = backends[defaultBackendName]
      ? { ...backends[defaultBackendName] }
      : {
          type: 'claude-code',
          model: 'opus',
          enableAgentTeams: false,
          chat: {
            mcpServers: [],
            session: {
              timeoutMinutes: 60,
              maxTurns: 10,
              maxEstimatedTokens: 50000,
              maxSessions: 200,
            },
          },
        }
    if (env.CAH_BACKEND_TYPE) {
      defaultBackend.type = env.CAH_BACKEND_TYPE as BackendConfig['type']
    }
    if (env.CAH_BACKEND_MODEL) {
      defaultBackend.model = env.CAH_BACKEND_MODEL
    }
    backends[defaultBackendName] = defaultBackend
    config = { ...config, backends }
  }

  return config
}

/**
 * 启动配置文件监听
 */
function startWatching(configPath: string): void {
  if (configWatcher && watchedPath === configPath) {
    return // 已在监听同一文件
  }

  // 停止旧的监听器
  stopWatching()

  logger.info(`Watching config file: ${configPath}`)
  watchedPath = configPath

  configWatcher = watch(configPath, async eventType => {
    if (eventType !== 'change') return

    // 防抖 500ms
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      try {
        logger.info('Config file changed, reloading...')
        const newConfig = await reloadConfig()
        cachedConfig = newConfig
        logger.info('✓ Config reloaded successfully')
      } catch (error) {
        const msg = formatErrorMessage(error)
        logger.error(`Failed to reload config: ${msg}`)
      }
    }, 500)
  })

  configWatcher.on('error', error => {
    logger.error(`Config watcher error: ${error.message}`)
  })
}

/**
 * 停止监听配置文件
 */
function stopWatching(): void {
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  if (configWatcher) {
    configWatcher.close()
    configWatcher = null
    watchedPath = null
    logger.debug('Config file watching stopped')
  }
}

/**
 * 获取默认配置
 */
export function getDefaultConfig(): Config {
  return {
    agents: [],
    tasks: {
      default_priority: 'medium',
      max_retries: 3,
      timeout: '30m',
    },
    git: {
      base_branch: 'main',
      branch_prefix: 'agent/',
      auto_push: false,
    },
    backends: {
      default: {
        type: 'claude-code',
        model: 'opus',
        enableAgentTeams: false,
        chat: {
          mcpServers: [],
          session: {
            timeoutMinutes: 60,
            maxTurns: 10,
            maxEstimatedTokens: 50_000,
            maxSessions: 200,
          },
        },
      },
    },
    defaultBackend: 'default',
    memory: {
      forgetting: {
        enabled: true,
        initialStability: 24,
        manualStability: 168,
        maxStability: 8760,
        archiveThreshold: 10,
        deleteThreshold: 5,
        cleanupIntervalHours: 1,
      },
      association: {
        enabled: true,
        overlapThreshold: 0.3,
        maxSpreadDepth: 2,
        maxAssociatedResults: 5,
      },
      reinforce: {
        retrieve: 1.2,
        taskSuccess: 2.0,
        taskFailure: 0.8,
        manualReview: 1.5,
        associationHit: 1.1,
      },
      chatMemory: {
        enabled: true,
        maxMemories: 5,
        extractEveryNTurns: 5,
        triggerKeywords: [],
      },
      episodic: {
        enabled: true,
      },
    },
  }
}

/**
 * 清除配置缓存
 */
export function clearConfigCache(): void {
  cachedConfig = null
}

/**
 * 停止配置文件监听（用于进程退出时清理）
 */
export function stopConfigWatch(): void {
  stopWatching()
}
