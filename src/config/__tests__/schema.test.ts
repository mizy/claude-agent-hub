/**
 * Config schema validation tests
 * Tests zod schemas for valid/invalid configuration
 */

import { describe, it, expect } from 'vitest'
import {
  configSchema,
  agentConfigSchema,
  taskConfigSchema,
  backendConfigSchema,
  larkConfigSchema,
  telegramConfigSchema,
} from '../schema.js'

describe('configSchema', () => {
  it('should parse empty object with defaults', () => {
    const result = configSchema.parse({})
    expect(result.agents).toEqual([])
    expect(result.tasks.default_priority).toBe('medium')
    expect(result.tasks.max_retries).toBe(3)
    expect(result.tasks.timeout).toBe('30m')
    expect(result.git.base_branch).toBe('main')
    expect(result.git.branch_prefix).toBe('agent/')
    expect(result.git.auto_push).toBe(false)
  })

  it('should parse full valid config', () => {
    const input = {
      agents: [{ name: 'test-agent', persona: 'Architect', role: 'developer' }],
      tasks: { default_priority: 'high', max_retries: 5, timeout: '1h' },
      git: { base_branch: 'develop', branch_prefix: 'feat/', auto_push: true },
      backends: {
        default: { type: 'opencode', model: 'gpt-4' },
      },
      defaultBackend: 'default',
    }
    const result = configSchema.parse(input)
    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.name).toBe('test-agent')
    expect(result.tasks.default_priority).toBe('high')
    expect(result.backends[result.defaultBackend]!.type).toBe('opencode')
  })

  it('should reject invalid priority', () => {
    const result = configSchema.safeParse({
      tasks: { default_priority: 'critical' },
    })
    expect(result.success).toBe(false)
  })

  it('should reject invalid backend type', () => {
    const result = configSchema.safeParse({
      backends: {
        default: { type: 'unknown-backend' },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('agentConfigSchema', () => {
  it('should parse minimal agent config', () => {
    const result = agentConfigSchema.parse({ name: 'my-agent' })
    expect(result.name).toBe('my-agent')
    expect(result.persona).toBe('Pragmatist')
    expect(result.role).toBe('developer')
  })

  it('should parse full agent config', () => {
    const result = agentConfigSchema.parse({
      name: 'reviewer',
      persona: 'Reviewer',
      role: 'reviewer',
      schedule: { poll_interval: '10m', work_hours: '09:00-18:00' },
    })
    expect(result.role).toBe('reviewer')
    expect(result.schedule?.poll_interval).toBe('10m')
  })

  it('should reject agent without name', () => {
    const result = agentConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('taskConfigSchema', () => {
  it('should apply defaults', () => {
    const result = taskConfigSchema.parse({})
    expect(result.default_priority).toBe('medium')
    expect(result.max_retries).toBe(3)
    expect(result.timeout).toBe('30m')
  })

  it('should accept valid priorities', () => {
    for (const p of ['low', 'medium', 'high']) {
      const result = taskConfigSchema.parse({ default_priority: p })
      expect(result.default_priority).toBe(p)
    }
  })
})

describe('backendConfigSchema', () => {
  it('should default to claude-code', () => {
    const result = backendConfigSchema.parse({})
    expect(result.type).toBe('claude-code')
    expect(result.model).toBe('opus')
  })

  it('should accept all valid backend types', () => {
    for (const type of ['claude-code', 'opencode', 'iflow', 'codebuddy']) {
      const result = backendConfigSchema.parse({ type })
      expect(result.type).toBe(type)
    }
  })

  it('should accept optional max_tokens', () => {
    const result = backendConfigSchema.parse({ max_tokens: 4096 })
    expect(result.max_tokens).toBe(4096)
  })
})

describe('larkConfigSchema', () => {
  it('should require appId and appSecret', () => {
    const result = larkConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should parse valid lark config', () => {
    const result = larkConfigSchema.parse({
      appId: 'cli_xxx',
      appSecret: 'secret_xxx',
      webhookUrl: 'https://open.feishu.cn/xxx',
    })
    expect(result.appId).toBe('cli_xxx')
    expect(result.webhookUrl).toBe('https://open.feishu.cn/xxx')
  })
})

describe('telegramConfigSchema', () => {
  it('should require botToken', () => {
    const result = telegramConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should parse valid telegram config', () => {
    const result = telegramConfigSchema.parse({
      botToken: '12345:ABCdefGHIjklMNO',
      chatId: '987654321',
    })
    expect(result.botToken).toBe('12345:ABCdefGHIjklMNO')
    expect(result.chatId).toBe('987654321')
  })
})
