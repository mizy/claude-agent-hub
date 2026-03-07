/**
 * Agent 加载
 * 支持内置 Agent、自定义 Agent 文件，以及 prompt 优化版本
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
import { BUILTIN_AGENTS, getAvailableAgents as getBuiltinNames } from './builtinAgents.js'
import { getActiveVersion, getPromptVersion } from '../store/PromptVersionStore.js'
import { selectVariant } from '../prompt-optimization/abTesting.js'
import { createLogger } from '../shared/logger.js'
import type { AgentConfig } from '../types/agent.js'

const DEFAULT_AGENT_NAME = 'Pragmatist'

const logger = createLogger('agent')

export async function loadAgent(name: string): Promise<AgentConfig> {
  // Load base agent config
  let config: AgentConfig

  if (BUILTIN_AGENTS[name]) {
    config = { ...BUILTIN_AGENTS[name] }
  } else {
    // 查找自定义角色文件
    const customPath = join(process.cwd(), 'templates', 'agents', `${name}.yaml`)
    if (existsSync(customPath)) {
      const content = await readFile(customPath, 'utf-8')
      config = YAML.parse(content) as AgentConfig
    } else {
      // 默认返回 Pragmatist
      logger.warn(`Agent "${name}" not found, falling back to Pragmatist`)
      config = { ...BUILTIN_AGENTS[DEFAULT_AGENT_NAME]! }
    }
  }

  // Check for A/B test variant or active optimized prompt version
  const variantId = selectVariant(name)
  if (variantId) {
    const variant = getPromptVersion(name, variantId)
    if (variant) {
      logger.info(`Using A/B test variant v${variant.version} (${variantId}) for ${name}`)
      config.systemPrompt = variant.systemPrompt
      return config
    }
  }

  const activeVersion = getActiveVersion(name)
  if (activeVersion) {
    logger.info(`Using optimized prompt v${activeVersion.version} for ${name}`)
    config.systemPrompt = activeVersion.systemPrompt
  }

  return config
}

export { getBuiltinNames as getAvailableAgents }
