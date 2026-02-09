import { readFile } from 'fs/promises'
import { existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'
import { createLogger } from '../shared/logger.js'
import { configSchema, type Config } from './schema.js'

const logger = createLogger('config')

const CONFIG_FILENAME = '.claude-agent-hub.yaml'

let cachedConfig: Config | null = null
let configWatcher: FSWatcher | null = null
let watchedPath: string | null = null

/**
 * 查找配置文件路径
 * 优先级：项目目录 > 用户主目录 > 默认配置
 */
function findConfigPath(cwd?: string): string | null {
  // 1. 项目目录
  const projectPath = join(cwd || process.cwd(), CONFIG_FILENAME)
  if (existsSync(projectPath)) return projectPath

  // 2. 用户主目录 ~/.claude-agent-hub.yaml
  const homePath = join(homedir(), CONFIG_FILENAME)
  if (existsSync(homePath)) return homePath

  return null
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

  if (cachedConfig && !enableWatch) {
    return cachedConfig
  }

  const configPath = findConfigPath(cwd)

  if (!configPath) {
    return getDefaultConfig()
  }

  const config = await loadConfigFromFile(configPath)

  // 启动监听（仅在首次加载且 watch=true 时）
  if (enableWatch && !configWatcher) {
    startWatching(configPath)
  }

  cachedConfig = config
  return cachedConfig
}

/**
 * 从文件加载并解析配置
 */
async function loadConfigFromFile(configPath: string): Promise<Config> {
  const content = await readFile(configPath, 'utf-8')
  const parsed = YAML.parse(content)

  // 验证配置
  const result = configSchema.safeParse(parsed)
  if (!result.success) {
    logger.warn('Config file format error, using defaults', result.error.issues)
    return getDefaultConfig()
  }

  const config = result.data

  // 向后兼容：若只有 claude 没有 backend，自动映射
  if (config.claude && !config.backend) {
    config.backend = {
      type: 'claude-code' as const,
      model: config.claude.model,
      max_tokens: config.claude.max_tokens,
      enableAgentTeams: false,
    }
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

  // 使用防抖避免多次触发
  let reloadTimer: NodeJS.Timeout | null = null

  configWatcher = watch(configPath, async (eventType) => {
    if (eventType !== 'change') return

    // 防抖 500ms
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      try {
        logger.info('Config file changed, reloading...')
        const newConfig = await loadConfigFromFile(configPath)
        cachedConfig = newConfig
        logger.info('✓ Config reloaded successfully')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
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
    backend: {
      type: 'claude-code',
      model: 'opus',
      enableAgentTeams: false,
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
