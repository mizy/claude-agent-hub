/**
 * resolveBackend tests
 * Tests backend resolution, registration, and caching
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveBackend,
  registerBackend,
  clearBackendCache,
  getRegisteredBackends,
} from '../resolveBackend.js'
import { createOpenAICompatibleBackend } from '../openaiCompatibleBackend.js'
import { ok } from '../../shared/result.js'
import type { BackendAdapter } from '../types.js'

// Mock loadConfig for auto-routing tests
const mockLoadConfig = vi.fn()
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>()
  return {
    ...actual,
    loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  }
})

beforeEach(() => {
  clearBackendCache()
  // Default: return basic config (claude-code, no openaiCompatible)
  mockLoadConfig.mockResolvedValue({
    backend: { type: 'claude-code', model: 'opus', chat: { mcpServers: [] } },
  })
})

describe('getRegisteredBackends', () => {
  it('should include all built-in backends', () => {
    const backends = getRegisteredBackends()
    expect(backends).toContain('claude-code')
    expect(backends).toContain('opencode')
    expect(backends).toContain('iflow')
    expect(backends).toContain('codebuddy')
    expect(backends).toContain('openai')
    expect(backends).toHaveLength(5)
  })
})

describe('registerBackend', () => {
  it('should register a custom backend', () => {
    const mockFactory = (): BackendAdapter => ({
      name: 'custom',
      displayName: 'Custom',
      cliBinary: 'custom-cli',
      capabilities: {
        supportsStreaming: false,
        supportsSessionReuse: false,
        supportsCostTracking: false,
        supportsMcpConfig: false,
        supportsAgentTeams: false,
      },
      checkAvailable: async () => true,
      invoke: async () => ok({ prompt: '', response: '', durationMs: 0, sessionId: '' }),
    })

    registerBackend('custom', mockFactory)
    const backends = getRegisteredBackends()
    expect(backends).toContain('custom')
  })
})

describe('resolveBackend', () => {
  it('should resolve default backend (claude-code)', async () => {
    const backend = await resolveBackend()
    expect(backend).toBeDefined()
    expect(backend.name).toBe('claude-code')
  })

  it('should cache resolved backend', async () => {
    const backend1 = await resolveBackend()
    const backend2 = await resolveBackend()
    expect(backend1).toBe(backend2) // Same reference
  })

  it('should return fresh backend after cache clear', async () => {
    await resolveBackend()
    clearBackendCache()
    const fresh = await resolveBackend()
    expect(fresh).toBeDefined()
    expect(fresh.name).toBe('claude-code')
  })
})

describe('resolveBackend — openaiCompatible auto-routing', () => {
  it('should route opencode to openai-compatible when openaiCompatible is configured', async () => {
    mockLoadConfig.mockResolvedValue({
      backend: {
        type: 'opencode',
        model: 'local-model',
        chat: { mcpServers: [] },
        openaiCompatible: {
          baseURL: 'http://localhost:1234/v1',
          defaultModel: 'my-local-model',
        },
      },
    })

    const backend = await resolveBackend()
    expect(backend.name).toBe('openai-compatible')
  })

  it('should keep opencode default behavior when no openaiCompatible', async () => {
    mockLoadConfig.mockResolvedValue({
      backend: {
        type: 'opencode',
        model: 'opencode/glm-4',
        chat: { mcpServers: [] },
      },
    })

    const backend = await resolveBackend()
    expect(backend.name).toBe('opencode')
  })

  it('should NOT double-route openai type (already openai-compatible)', async () => {
    mockLoadConfig.mockResolvedValue({
      backend: {
        type: 'openai',
        model: 'gpt-4',
        chat: { mcpServers: [] },
        openaiCompatible: {
          baseURL: 'http://localhost:1234/v1',
        },
      },
    })

    const backend = await resolveBackend()
    expect(backend.name).toBe('openai-compatible')
  })

  it('should route named backend with openaiCompatible to openai-compatible', async () => {
    mockLoadConfig.mockResolvedValue({
      backend: { type: 'claude-code', model: 'opus', chat: { mcpServers: [] } },
      backends: {
        local: {
          type: 'opencode',
          model: 'local',
          chat: { mcpServers: [] },
          openaiCompatible: {
            baseURL: 'http://localhost:1234/v1',
            defaultModel: 'my-local-model',
          },
        },
      },
    })

    const backend = await resolveBackend('local')
    expect(backend.name).toBe('openai-compatible')
  })

  it('should use defaultBackend with openaiCompatible auto-routing', async () => {
    mockLoadConfig.mockResolvedValue({
      backend: { type: 'claude-code', model: 'opus', chat: { mcpServers: [] } },
      defaultBackend: 'local',
      backends: {
        local: {
          type: 'opencode',
          model: 'local',
          chat: { mcpServers: [] },
          openaiCompatible: {
            baseURL: 'http://localhost:8080/v1',
          },
        },
      },
    })

    const backend = await resolveBackend()
    expect(backend.name).toBe('openai-compatible')
  })

  it('should throw for unknown backend type', async () => {
    mockLoadConfig.mockResolvedValue({
      backend: { type: 'nonexistent', model: '', chat: { mcpServers: [] } },
    })

    await expect(resolveBackend()).rejects.toThrow('未知后端: nonexistent')
  })
})

describe('createOpenAICompatibleBackend', () => {
  it('should create adapter with correct structure', () => {
    const backend = createOpenAICompatibleBackend()
    expect(backend.name).toBe('openai-compatible')
    expect(backend.displayName).toBe('OpenAI Compatible')
    expect(backend.cliBinary).toBe('')
    expect(backend.capabilities.supportsStreaming).toBe(true)
    expect(backend.capabilities.supportsSessionReuse).toBe(true)
  })

  it('checkAvailable should use resolveBackendConfig with backendName', async () => {
    // Spy on resolveBackendConfig to verify it's called with the correct backendName
    const resolveConfigSpy = vi.spyOn(
      await import('../resolveBackend.js'),
      'resolveBackendConfig'
    )

    const backend = createOpenAICompatibleBackend('my-custom-backend')
    // checkAvailable will call resolveBackendConfig('my-custom-backend')
    // and likely return false since no real config exists, but we verify the call
    await backend.checkAvailable()

    expect(resolveConfigSpy).toHaveBeenCalledWith('my-custom-backend')
    resolveConfigSpy.mockRestore()
  })

  it('checkAvailable should return false when no openaiCompatible config', async () => {
    // Default config has no openaiCompatible section
    const backend = createOpenAICompatibleBackend()
    const available = await backend.checkAvailable()
    expect(available).toBe(false)
  })

  it('invoke should return error when no openaiCompatible config', async () => {
    const backend = createOpenAICompatibleBackend()
    const result = await backend.invoke({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.type).toBe('process')
      expect(result.error.message).toContain('openaiCompatible config is required')
    }
  })

  it('invoke should use resolveBackendConfig with backendName', async () => {
    const resolveConfigSpy = vi.spyOn(
      await import('../resolveBackend.js'),
      'resolveBackendConfig'
    )

    const backend = createOpenAICompatibleBackend('named-backend')
    await backend.invoke({ prompt: 'test' })

    expect(resolveConfigSpy).toHaveBeenCalledWith('named-backend')
    resolveConfigSpy.mockRestore()
  })
})
