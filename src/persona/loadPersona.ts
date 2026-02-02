/**
 * Persona 加载
 * 支持内置 Persona 和自定义 Persona 文件
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import YAML from 'yaml'
import { BUILTIN_PERSONAS, getAvailablePersonas as getBuiltinNames } from './builtinPersonas.js'
import type { PersonaConfig } from '../types/persona.js'

export async function loadPersona(name: string): Promise<PersonaConfig> {
  // 优先查找内置人格
  if (BUILTIN_PERSONAS[name]) {
    return BUILTIN_PERSONAS[name]
  }

  // 查找自定义人格文件
  const customPath = join(process.cwd(), 'templates', 'personas', `${name}.yaml`)
  if (existsSync(customPath)) {
    const content = await readFile(customPath, 'utf-8')
    return YAML.parse(content) as PersonaConfig
  }

  // 默认返回 Pragmatist
  console.warn(`人格 "${name}" 未找到，使用默认 Pragmatist`)
  return BUILTIN_PERSONAS.Pragmatist!
}

export { getBuiltinNames as getAvailablePersonas }
