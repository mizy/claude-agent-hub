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

export const claudeConfigSchema = z.object({
  model: z.enum(['haiku', 'sonnet', 'opus']).default('opus'),
  max_tokens: z.number().default(8000)
})

export const larkConfigSchema = z.object({
  webhookUrl: z.string().optional(),        // 飞书 webhook URL
  appId: z.string().optional(),             // 飞书应用 ID（@回复用）
  appSecret: z.string().optional(),         // 飞书应用密钥
  serverPort: z.number().default(3000),     // 事件监听端口
})

export const notifyConfigSchema = z.object({
  lark: larkConfigSchema.optional(),
})

export const configSchema = z.object({
  agents: z.array(agentConfigSchema).default([]),
  tasks: taskConfigSchema.default({}),
  git: gitConfigSchema.default({}),
  claude: claudeConfigSchema.default({}),
  notify: notifyConfigSchema.optional(),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>
export type TaskConfig = z.infer<typeof taskConfigSchema>
export type GitConfig = z.infer<typeof gitConfigSchema>
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>
export type LarkConfig = z.infer<typeof larkConfigSchema>
export type NotifyConfig = z.infer<typeof notifyConfigSchema>
export type Config = z.infer<typeof configSchema>
