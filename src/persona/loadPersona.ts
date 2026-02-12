/**
 * Persona 加载
 * 支持内置 Persona、自定义 Persona 文件，以及 prompt 优化版本
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
import { BUILTIN_PERSONAS, getAvailablePersonas as getBuiltinNames } from './builtinPersonas.js'
import { getActiveVersion } from '../store/PromptVersionStore.js'
import { createLogger } from '../shared/logger.js'
import type { PersonaConfig } from '../types/persona.js'

const logger = createLogger('persona')

export async function loadPersona(name: string): Promise<PersonaConfig> {
  // Load base persona config
  let config: PersonaConfig

  if (BUILTIN_PERSONAS[name]) {
    config = { ...BUILTIN_PERSONAS[name] }
  } else {
    // 查找自定义人格文件
    const customPath = join(process.cwd(), 'templates', 'personas', `${name}.yaml`)
    if (existsSync(customPath)) {
      const content = await readFile(customPath, 'utf-8')
      config = YAML.parse(content) as PersonaConfig
    } else {
      // 默认返回 Pragmatist
      logger.warn(`Persona "${name}" not found, falling back to Pragmatist`)
      config = { ...BUILTIN_PERSONAS.Pragmatist! }
    }
  }

  // Check for active optimized prompt version
  const activeVersion = getActiveVersion(name)
  if (activeVersion) {
    logger.info(`Using optimized prompt v${activeVersion.version} for ${name}`)
    config.systemPrompt = activeVersion.systemPrompt
  }

  return config
}

export { getBuiltinNames as getAvailablePersonas }
