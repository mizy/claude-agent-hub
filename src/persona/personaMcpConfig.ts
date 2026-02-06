/**
 * Persona 到 MCP 服务器的映射配置
 * 不同角色需要不同的外部工具集成
 */

/** MCP 服务器名称 (与用户 claude 配置中的名称对应) */
export type McpServerName =
  | 'puppeteer' // 浏览器自动化
  | 'mcp-atlassian' // Jira/Confluence
  | 'codeup-git' // 阿里云 Codeup

/**
 * 每个 Persona 需要的 MCP 服务器
 * 没有列出的 Persona 默认不启用任何 MCP 服务器
 */
export const PERSONA_MCP_CONFIG: Record<string, McpServerName[]> = {
  // 架构师：专注系统设计，不需要外部集成
  Architect: [],

  // 务实开发者：专注本地代码，不需要外部集成
  Pragmatist: [],

  // 完美主义者：专注代码质量，不需要外部集成
  Perfectionist: [],

  // 探索者：需要浏览器探索
  Explorer: ['puppeteer'],

  // 测试专家：需要浏览器测试、Jira 跟踪 bug
  Tester: ['puppeteer', 'mcp-atlassian'],

  // 代码审查
  Reviewer: [],

  // 安全专家
  Security: [],

  // DevOps：需要 Jira/Codeup 集成
  DevOps: ['mcp-atlassian', 'codeup-git'],
}

/**
 * 获取指定 Persona 需要的 MCP 服务器列表
 */
export function getPersonaMcpServers(persona: string): McpServerName[] {
  return PERSONA_MCP_CONFIG[persona] ?? []
}

/**
 * 检查 Persona 是否需要 MCP 服务器
 */
export function personaNeedsMcp(persona: string): boolean {
  const servers = getPersonaMcpServers(persona)
  return servers.length > 0
}
