import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'
import { createLogger } from '../shared/logger.js'
import { configSchema, type Config } from './schema.js'

const logger = createLogger('config')

const CONFIG_FILENAME = '.claude-agent-hub.yaml'

let cachedConfig: Config | null = null

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
 */
export async function loadConfig(cwd?: string): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig
  }

  const configPath = findConfigPath(cwd)

  if (!configPath) {
    return getDefaultConfig()
  }

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
    }
  }

  cachedConfig = config
  return cachedConfig
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
    },
  }
}

/**
 * 清除配置缓存
 */
export function clearConfigCache(): void {
  cachedConfig = null
}
