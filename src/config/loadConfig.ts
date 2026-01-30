import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
import { configSchema, type Config } from './schema.js'

const CONFIG_FILENAME = '.claude-agent-hub.yaml'

let cachedConfig: Config | null = null

/**
 * 加载项目配置
 */
export async function loadConfig(cwd?: string): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig
  }

  const configPath = join(cwd || process.cwd(), CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    // 返回默认配置
    return getDefaultConfig()
  }

  const content = await readFile(configPath, 'utf-8')
  const parsed = YAML.parse(content)

  // 验证配置
  const result = configSchema.safeParse(parsed)
  if (!result.success) {
    console.warn('配置文件格式错误，使用默认配置')
    console.warn(result.error.issues)
    return getDefaultConfig()
  }

  cachedConfig = result.data
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
      timeout: '30m'
    },
    git: {
      base_branch: 'main',
      branch_prefix: 'agent/',
      auto_push: false
    },
    claude: {
      model: 'sonnet',
      max_tokens: 8000
    }
  }
}

/**
 * 清除配置缓存
 */
export function clearConfigCache(): void {
  cachedConfig = null
}
