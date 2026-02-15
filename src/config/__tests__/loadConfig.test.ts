/**
 * loadConfig tests
 * Tests config loading, caching, and fallback behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `cah-config-test-${Date.now()}`)

// Mock homedir to prevent loading user's real ~/.claude-agent-hub.yaml
vi.mock('os', async importOriginal => {
  const os = await importOriginal<typeof import('os')>()
  return { ...os, homedir: () => TEST_DIR }
})

const { loadConfig, getDefaultConfig, clearConfigCache, stopConfigWatch, applyEnvOverrides } =
  await import('../loadConfig.js')

beforeEach(() => {
  clearConfigCache()
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  clearConfigCache()
  stopConfigWatch()
  try {
    rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('getDefaultConfig', () => {
  it('should return valid default config', () => {
    const config = getDefaultConfig()
    expect(config.agents).toEqual([])
    expect(config.tasks.default_priority).toBe('medium')
    expect(config.tasks.max_retries).toBe(3)
    expect(config.git.base_branch).toBe('main')
    expect(config.backend.type).toBe('claude-code')
    expect(config.backend.model).toBe('opus')
  })
})

describe('loadConfig', () => {
  it('should return default config when no config file exists', async () => {
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config).toEqual(getDefaultConfig())
  })

  it('should load config from YAML file', async () => {
    const yamlContent = `
tasks:
  default_priority: high
  max_retries: 5
  timeout: 1h
git:
  base_branch: develop
  auto_push: true
backend:
  type: opencode
  model: gpt-4
`
    writeFileSync(join(TEST_DIR, '.claude-agent-hub.yaml'), yamlContent)

    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.tasks.default_priority).toBe('high')
    expect(config.tasks.max_retries).toBe(5)
    expect(config.git.base_branch).toBe('develop')
    expect(config.git.auto_push).toBe(true)
    expect(config.backend.type).toBe('opencode')
  })

  it('should always have backend defaults even without backend in YAML', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
tasks:
  default_priority: high
`
    )

    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.backend.type).toBe('claude-code')
    expect(config.backend.model).toBe('opus')
    expect(config.backend.enableAgentTeams).toBe(false)
  })

  it('should cache loaded config', async () => {
    const yamlContent = `
tasks:
  default_priority: low
`
    writeFileSync(join(TEST_DIR, '.claude-agent-hub.yaml'), yamlContent)

    const config1 = await loadConfig({ cwd: TEST_DIR })
    const config2 = await loadConfig({ cwd: TEST_DIR })
    expect(config1).toBe(config2) // Same reference (cached)
  })

  it('should return fresh config after cache clear', async () => {
    const config1 = await loadConfig({ cwd: TEST_DIR })
    clearConfigCache()
    const config2 = await loadConfig({ cwd: TEST_DIR })
    expect(config1).not.toBe(config2) // Different reference
    expect(config1).toEqual(config2) // Same content
  })

  it('should handle invalid YAML gracefully', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
tasks:
  default_priority: invalid_value_not_in_enum
`
    )

    const config = await loadConfig({ cwd: TEST_DIR })
    // Should fall back to defaults on validation failure
    expect(config).toEqual(getDefaultConfig())
  })

  it('should ignore unknown fields in YAML', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
some_unknown_field:
  key: value
backend:
  type: opencode
  model: gpt-4
`
    )

    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.backend.type).toBe('opencode')
    expect(config.backend.model).toBe('gpt-4')
  })

  it('should not throw when stopConfigWatch called multiple times', () => {
    stopConfigWatch()
    stopConfigWatch()
    // No error means success
  })

  it('should start and stop watching without error', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
tasks:
  default_priority: medium
`
    )

    // Load with watch enabled
    await loadConfig({ cwd: TEST_DIR, watch: true })
    // Stop should clean up watcher and any pending reload timer
    stopConfigWatch()
    // Should be able to load again without issues
    clearConfigCache()
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.tasks.default_priority).toBe('medium')
  })
})

describe('applyEnvOverrides', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = [
    'CAH_LARK_APP_ID',
    'CAH_LARK_APP_SECRET',
    'CAH_LARK_WEBHOOK_URL',
    'CAH_TELEGRAM_BOT_TOKEN',
    'CAH_BACKEND_TYPE',
    'CAH_BACKEND_MODEL',
  ]

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  it('should override lark appId from env', () => {
    process.env.CAH_LARK_APP_ID = 'env-app-id'
    const config = applyEnvOverrides(getDefaultConfig())
    expect(config.notify?.lark?.appId).toBe('env-app-id')
  })

  it('should override lark appSecret and webhookUrl from env', () => {
    process.env.CAH_LARK_APP_SECRET = 'env-secret'
    process.env.CAH_LARK_WEBHOOK_URL = 'https://hook.example.com'
    const config = applyEnvOverrides(getDefaultConfig())
    expect(config.notify?.lark?.appSecret).toBe('env-secret')
    expect(config.notify?.lark?.webhookUrl).toBe('https://hook.example.com')
  })

  it('should override telegram botToken from env', () => {
    process.env.CAH_TELEGRAM_BOT_TOKEN = 'env-bot-token'
    const config = applyEnvOverrides(getDefaultConfig())
    expect(config.notify?.telegram?.botToken).toBe('env-bot-token')
  })

  it('should override backend type and model from env', () => {
    process.env.CAH_BACKEND_TYPE = 'opencode'
    process.env.CAH_BACKEND_MODEL = 'gpt-4'
    const config = applyEnvOverrides(getDefaultConfig())
    expect(config.backend.type).toBe('opencode')
    expect(config.backend.model).toBe('gpt-4')
  })

  it('should not override when env vars are not set', () => {
    const original = getDefaultConfig()
    const config = applyEnvOverrides(getDefaultConfig())
    expect(config.backend.type).toBe(original.backend.type)
    expect(config.backend.model).toBe(original.backend.model)
    expect(config.notify).toBeUndefined()
  })

  it('should prioritize env vars over file config', () => {
    process.env.CAH_BACKEND_MODEL = 'env-model'
    const base = getDefaultConfig()
    base.backend.model = 'file-model'
    const config = applyEnvOverrides(base)
    expect(config.backend.model).toBe('env-model')
  })

  it('should integrate with loadConfig (env overrides applied)', async () => {
    process.env.CAH_BACKEND_MODEL = 'sonnet'
    clearConfigCache()
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.backend.model).toBe('sonnet')
  })
})

describe('config sub-accessors', () => {
  // Test that loadConfig result can be correctly sliced into sub-configs.
  // This validates the same logic used by getLarkConfig/getBackendConfig/etc in index.ts.
  beforeEach(() => {
    clearConfigCache()
  })

  it('notify.lark is undefined when no lark configured', async () => {
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.notify?.lark).toBeUndefined()
  })

  it('notify.lark returns lark config when configured', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
notify:
  lark:
    appId: test-id
    appSecret: test-secret
`
    )
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.notify?.lark?.appId).toBe('test-id')
    expect(config.notify?.lark?.appSecret).toBe('test-secret')
  })

  it('notify is undefined when no notify configured', async () => {
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.notify).toBeUndefined()
  })

  it('notify returns full notify config when configured', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
notify:
  lark:
    appId: test-id
    appSecret: test-secret
  telegram:
    botToken: test-token
`
    )
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.notify?.lark?.appId).toBe('test-id')
    expect(config.notify?.telegram?.botToken).toBe('test-token')
  })

  it('backend always has valid defaults', async () => {
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.backend.type).toBe('claude-code')
    expect(config.backend.model).toBe('opus')
    expect(config.backend.enableAgentTeams).toBe(false)
    expect(config.backend.chat.mcpServers).toEqual([])
  })

  it('backend returns file values when configured', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
backend:
  type: opencode
  model: gpt-4
`
    )
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.backend.type).toBe('opencode')
    expect(config.backend.model).toBe('gpt-4')
  })

  it('tasks always has valid defaults', async () => {
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.tasks.default_priority).toBe('medium')
    expect(config.tasks.max_retries).toBe(3)
    expect(config.tasks.timeout).toBe('30m')
  })

  it('tasks returns file values when configured', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
tasks:
  default_priority: high
  max_retries: 5
`
    )
    const config = await loadConfig({ cwd: TEST_DIR })
    expect(config.tasks.default_priority).toBe('high')
    expect(config.tasks.max_retries).toBe(5)
  })
})
