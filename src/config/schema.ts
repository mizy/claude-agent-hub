import { z } from 'zod'

export const agentConfigSchema = z.object({
  name: z.string(),
  persona: z.string().default('Pragmatist'),
  role: z.enum(['developer', 'reviewer', 'both']).default('developer'),
  schedule: z.object({
    poll_interval: z.string().default('5m'),
    work_hours: z.string().optional()
  }).optional()
})

export const taskConfigSchema = z.object({
  default_priority: z.enum(['low', 'medium', 'high']).default('medium'),
  max_retries: z.number().default(3),
  timeout: z.string().default('30m')
})

export const gitConfigSchema = z.object({
  base_branch: z.string().default('main'),
  branch_prefix: z.string().default('agent/'),
  auto_push: z.boolean().default(false)
})

export const backendConfigSchema = z.object({
  /** 后端类型: claude-code | opencode | iflow | codebuddy */
  type: z.enum(['claude-code', 'opencode', 'iflow', 'codebuddy']).default('claude-code'),
  /** 模型名（含义因后端而异） */
  model: z.string().default('opus'),
  /** 最大 token 数（部分后端支持） */
  max_tokens: z.number().optional(),
})

/** @deprecated 使用 backendConfigSchema */
export const claudeConfigSchema = z.object({
  model: z.enum(['haiku', 'sonnet', 'opus']).default('opus'),
  max_tokens: z.number().default(8000)
})

export const larkConfigSchema = z.object({
  webhookUrl: z.string().optional(),        // 飞书 webhook URL（向后兼容）
  appId: z.string(),                        // 飞书应用 ID（WSClient 必需）
  appSecret: z.string(),                    // 飞书应用密钥（WSClient 必需）
})

export const telegramConfigSchema = z.object({
  botToken: z.string(),                     // Telegram Bot Token
  chatId: z.string().optional(),            // 默认 Chat ID
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
  /** 新配置：CLI 后端设置 */
  backend: backendConfigSchema.optional(),
  /** @deprecated 使用 backend，旧配置仍可用 */
  claude: claudeConfigSchema.optional(),
  notify: notifyConfigSchema.optional(),
  daemon: daemonConfigSchema.optional(),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>
export type TaskConfig = z.infer<typeof taskConfigSchema>
export type GitConfig = z.infer<typeof gitConfigSchema>
export type BackendConfig = z.infer<typeof backendConfigSchema>
/** @deprecated 使用 BackendConfig */
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>
export type LarkConfig = z.infer<typeof larkConfigSchema>
export type TelegramConfig = z.infer<typeof telegramConfigSchema>
export type NotifyConfig = z.infer<typeof notifyConfigSchema>
export type DaemonConfig = z.infer<typeof daemonConfigSchema>
export type Config = z.infer<typeof configSchema>
