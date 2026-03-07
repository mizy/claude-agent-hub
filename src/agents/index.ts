/**
 * @entry Agent 角色系统
 *
 * 提供 AI Agent 的角色定义和加载能力
 *
 * 主要 API:
 * - BUILTIN_AGENTS / getBuiltinAgent / getAvailableAgents: 内置角色定义与查询
 * - loadAgent(): 加载角色配置
 * - agentNeedsMcp(): 检查角色是否需要 MCP
 */

// 内置 Agent
export { BUILTIN_AGENTS, getBuiltinAgent, getAvailableAgents } from './builtinAgents.js'

// Agent 加载
export { loadAgent } from './loadAgent.js'

// MCP 配置
export { agentNeedsMcp } from './agentMcpConfig.js'
