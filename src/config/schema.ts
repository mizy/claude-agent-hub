import { z } from 'zod'

export const agentConfigSchema = z.object({
  name: z.string(),
  persona: z.string().default('Pragmatist'),
  role: z.enum(['developer', 'reviewer', 'both']).default('developer'),
  schedule: z
    .object({
      poll_interval: z.string().default('5m'),
      work_hours: z.string().optional(),
    })
    .optional(),
})

export const taskConfigSchema = z.object({
  default_priority: z.enum(['low', 'medium', 'high']).default('medium'),
  max_retries: z.number().default(3),
  timeout: z.string().default('30m'),
})

export const gitConfigSchema = z.object({
  base_branch: z.string().default('main'),
  branch_prefix: z.string().default('agent/'),
  auto_push: z.boolean().default(false),
})

export const chatConfigSchema = z.object({
  /** MCP servers to enable in chat mode (empty = all disabled for speed) */
  mcpServers: z.array(z.string()).default([]),
})

export const backendConfigSchema = z.object({
  /** 后端类型: claude-code | opencode | iflow | codebuddy */
  type: z.enum(['claude-code', 'opencode', 'iflow', 'codebuddy']).default('claude-code'),
  /** 模型名（含义因后端而异） */
  model: z.string().default('opus'),
  /** 最大 token 数（部分后端支持） */
  max_tokens: z.number().optional(),
  /** 启用 Agent Teams（实验性功能，仅 claude-code 支持）用于 workflow 生成 */
  enableAgentTeams: z.boolean().optional().default(false),
  /** 对话模式配置 */
  chat: chatConfigSchema.default({}),
})

export const larkConfigSchema = z.object({
  webhookUrl: z.string().optional(), // 飞书 webhook URL（向后兼容）
  appId: z.string(), // 飞书应用 ID（WSClient 必需）
  appSecret: z.string(), // 飞书应用密钥（WSClient 必需）
  chatId: z.string().optional(), // 默认 Chat ID（用于推送通知）
})

export const telegramConfigSchema = z.object({
  botToken: z.string(), // Telegram Bot Token
  chatId: z.string().optional(), // 默认 Chat ID
})

export const notifyConfigSchema = z.object({
  lark: larkConfigSchema.optional(),
  telegram: telegramConfigSchema.optional(),
})

export const daemonConfigSchema = z.object({
  poll_interval: z.string().default('5m'),
})

export const configSchema = z.object({
  agents: z.array(agentConfigSchema).default([]),
  tasks: taskConfigSchema.default({}),
  git: gitConfigSchema.default({}),
  /** CLI 后端设置（默认 backend） */
  backend: backendConfigSchema.default({}),
  /** 命名 backend 配置映射，允许定义多个 backend 供任务级切换 */
  backends: z.record(z.string(), backendConfigSchema).optional(),
  /** 默认使用的命名 backend（覆盖 backend 字段） */
  defaultBackend: z.string().optional(),
  notify: notifyConfigSchema.optional(),
  daemon: daemonConfigSchema.optional(),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>
export type TaskConfig = z.infer<typeof taskConfigSchema>
export type GitConfig = z.infer<typeof gitConfigSchema>
export type BackendConfig = z.infer<typeof backendConfigSchema>
export type ChatConfig = z.infer<typeof chatConfigSchema>
export type LarkConfig = z.infer<typeof larkConfigSchema>
export type TelegramConfig = z.infer<typeof telegramConfigSchema>
export type NotifyConfig = z.infer<typeof notifyConfigSchema>
export type DaemonConfig = z.infer<typeof daemonConfigSchema>
export type Config = z.infer<typeof configSchema>
