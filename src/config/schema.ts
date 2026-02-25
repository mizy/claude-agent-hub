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

export const sessionConfigSchema = z.object({
  /** Session timeout in minutes (default 60) */
  timeoutMinutes: z.number().default(60),
  /** Max turns before auto-reset (default 10) */
  maxTurns: z.number().default(10),
  /** Max estimated tokens before auto-reset (default 50000) */
  maxEstimatedTokens: z.number().default(50_000),
  /** Max concurrent sessions in memory (LRU eviction, default 200) */
  maxSessions: z.number().default(200),
})

export const chatConfigSchema = z.object({
  /** MCP servers to enable in chat mode (empty = all disabled for speed) */
  mcpServers: z.array(z.string()).default([]),
  /** Session management settings */
  session: sessionConfigSchema.default({}),
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

export const memoryForgettingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  initialStability: z.number().default(24),
  manualStability: z.number().default(168),
  maxStability: z.number().default(8760),
  archiveThreshold: z.number().default(10),
  deleteThreshold: z.number().default(5),
  cleanupIntervalHours: z.number().default(1),
})

export const memoryAssociationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  overlapThreshold: z.number().default(0.3),
  maxSpreadDepth: z.number().default(2),
  maxAssociatedResults: z.number().default(5),
})

export const memoryReinforceConfigSchema = z.object({
  retrieve: z.number().default(1.2),
  taskSuccess: z.number().default(2.0),
  taskFailure: z.number().default(0.8),
  manualReview: z.number().default(1.5),
  associationHit: z.number().default(1.1),
})

export const chatMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxMemories: z.number().default(5),
  /** How many turns between periodic extractions (default 5) */
  extractEveryNTurns: z.number().default(5),
  /** Extra trigger keywords (beyond built-in remember/decision/correction/emphasis keywords) */
  triggerKeywords: z.array(z.string()).default([]),
})

export const episodicMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const memoryConfigSchema = z.object({
  forgetting: memoryForgettingConfigSchema.default({}),
  association: memoryAssociationConfigSchema.default({}),
  reinforce: memoryReinforceConfigSchema.default({}),
  chatMemory: chatMemoryConfigSchema.default({}),
  episodic: episodicMemoryConfigSchema.default({}),
})

export const daemonConfigSchema = z.object({
  poll_interval: z.string().default('5m'),
})

export const configSchema = z.object({
  agents: z.array(agentConfigSchema).default([]),
  tasks: taskConfigSchema.default({}),
  git: gitConfigSchema.default({}),
  /** 命名 backend 配置映射，至少需要定义一个 */
  backends: z.record(z.string(), backendConfigSchema).default({}),
  /** 默认使用的 backend 名称，指向 backends 中的 key */
  defaultBackend: z.string().default('default'),
  notify: notifyConfigSchema.optional(),
  daemon: daemonConfigSchema.optional(),
  memory: memoryConfigSchema.default({}),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>
export type TaskConfig = z.infer<typeof taskConfigSchema>
export type GitConfig = z.infer<typeof gitConfigSchema>
export type BackendConfig = z.infer<typeof backendConfigSchema>
export type SessionConfig = z.infer<typeof sessionConfigSchema>
export type ChatConfig = z.infer<typeof chatConfigSchema>
export type LarkConfig = z.infer<typeof larkConfigSchema>
export type TelegramConfig = z.infer<typeof telegramConfigSchema>
export type NotifyConfig = z.infer<typeof notifyConfigSchema>
export type DaemonConfig = z.infer<typeof daemonConfigSchema>
export type MemoryForgettingConfig = z.infer<typeof memoryForgettingConfigSchema>
export type MemoryAssociationConfig = z.infer<typeof memoryAssociationConfigSchema>
export type MemoryReinforceConfig = z.infer<typeof memoryReinforceConfigSchema>
export type ChatMemoryConfig = z.infer<typeof chatMemoryConfigSchema>
export type EpisodicMemoryConfig = z.infer<typeof episodicMemoryConfigSchema>
export type MemoryConfig = z.infer<typeof memoryConfigSchema>
export type Config = z.infer<typeof configSchema>
