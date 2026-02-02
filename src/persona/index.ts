/**
 * @entry Persona 人格系统
 *
 * 提供 AI Agent 的人格定义和加载能力
 *
 * 主要 API:
 * - BUILTIN_PERSONAS: 内置人格定义
 * - loadPersona(): 加载人格配置
 * - personaNeedsMcp(): 检查人格是否需要 MCP
 */

// 内置 Persona
export {
  BUILTIN_PERSONAS,
  getBuiltinPersona,
  getAvailablePersonas,
} from './builtinPersonas.js'

// Persona 加载
export { loadPersona } from './loadPersona.js'

// MCP 配置
export { personaNeedsMcp } from './personaMcpConfig.js'
