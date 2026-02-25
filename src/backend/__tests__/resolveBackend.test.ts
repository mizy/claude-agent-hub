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
import { ok } from '../../shared/result.js'
import type { BackendAdapter } from '../types.js'

const mockLoadConfig = vi.fn()
vi.mock('../../config/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config/index.js')>()
  return {
    ...actual,
    loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  }
})

beforeEach(() => {
  clearBackendCache()
  mockLoadConfig.mockResolvedValue({
    backends: {
      default: {
        type: 'claude-code',
        model: 'opus',
        chat: { mcpServers: [], session: {} },
        enableAgentTeams: false,
      },
    },
    defaultBackend: 'default',
  })
})

describe('getRegisteredBackends', () => {
  it('should include all built-in backends', () => {
    const backends = getRegisteredBackends()
    expect(backends).toContain('claude-code')
    expect(backends).toContain('opencode')
    expect(backends).toContain('iflow')
    expect(backends).toContain('codebuddy')
    expect(backends).toHaveLength(4)
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
    expect(backend1).toBe(backend2)
  })

  it('should return fresh backend after cache clear', async () => {
    await resolveBackend()
    clearBackendCache()
    const fresh = await resolveBackend()
    expect(fresh).toBeDefined()
    expect(fresh.name).toBe('claude-code')
  })

  it('should resolve named backend', async () => {
    mockLoadConfig.mockResolvedValue({
      backends: {
        default: {
          type: 'claude-code',
          model: 'opus',
          chat: { mcpServers: [], session: {} },
          enableAgentTeams: false,
        },
        mybackend: {
          type: 'opencode',
          model: 'opus',
          chat: { mcpServers: [], session: {} },
          enableAgentTeams: false,
        },
      },
      defaultBackend: 'default',
    })

    const backend = await resolveBackend('mybackend')
    expect(backend.name).toBe('opencode')
  })

  it('should throw for unknown backend type', async () => {
    mockLoadConfig.mockResolvedValue({
      backends: {
        default: {
          type: 'nonexistent',
          model: '',
          chat: { mcpServers: [], session: {} },
          enableAgentTeams: false,
        },
      },
      defaultBackend: 'default',
    })

    await expect(resolveBackend()).rejects.toThrow('未知后端: nonexistent')
  })
})
