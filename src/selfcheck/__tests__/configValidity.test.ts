import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configValidityCheck } from '../checks/configValidity.js'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

import { existsSync, readFileSync } from 'fs'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)

describe('configValidityCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should warn when no config files exist', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await configValidityCheck.run()
    expect(result.status).toBe('warning')
    expect(result.score).toBe(80)
    expect(result.details).toContainEqual(expect.stringContaining('No config file'))
  })

  it('should pass on valid YAML config', async () => {
    // Only home config exists
    mockExistsSync.mockImplementation((path) => {
      return String(path).includes('.claude-agent-hub.yaml') && String(path).includes('/')
    })
    mockReadFileSync.mockReturnValue('backend:\n  type: claude-code\n  model: opus\n')
    const result = await configValidityCheck.run()
    // Should be pass or warning (depending on global/project path match)
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('should deduct score on invalid YAML syntax', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('invalid: yaml: [broken')
    const result = await configValidityCheck.run()
    expect(result.score).toBeLessThan(100)
    expect(result.details.some((d) => d.includes('invalid YAML'))).toBe(true)
  })

  it('should handle empty config file gracefully', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('')
    const result = await configValidityCheck.run()
    // Empty YAML parses to null, which we treat as "using defaults"
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('should report schema issues', async () => {
    mockExistsSync.mockReturnValue(true)
    // Valid YAML but invalid schema (unknown backend type)
    mockReadFileSync.mockReturnValue('backend:\n  type: nonexistent-backend\n')
    const result = await configValidityCheck.run()
    expect(result.score).toBeLessThan(100)
    expect(result.details.some((d) => d.includes('schema issues'))).toBe(true)
  })
})
