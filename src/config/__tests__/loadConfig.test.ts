/**
 * loadConfig tests
 * Tests config loading, caching, and fallback behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadConfig, getDefaultConfig, clearConfigCache, stopConfigWatch } from '../loadConfig.js'

const TEST_DIR = join(tmpdir(), `cah-config-test-${Date.now()}`)

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
    expect(config.backend?.type).toBe('claude-code')
    expect(config.backend?.model).toBe('opus')
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
    expect(config.backend?.type).toBe('opencode')
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

  it('should handle backward compat: claude -> backend mapping', async () => {
    writeFileSync(
      join(TEST_DIR, '.claude-agent-hub.yaml'),
      `
claude:
  model: sonnet
  max_tokens: 4000
`
    )

    const config = await loadConfig({ cwd: TEST_DIR })
    // claude config should be mapped to backend
    expect(config.backend?.type).toBe('claude-code')
    expect(config.backend?.model).toBe('sonnet')
    expect(config.backend?.max_tokens).toBe(4000)
  })
})
