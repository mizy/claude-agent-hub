/**
 * cursorBackend unit tests
 *
 * Tests adapter structure, capabilities, and output parsing.
 * invoke() depends on execa so we only test pure logic here.
 */

import { describe, it, expect } from 'vitest'
import { createCursorBackend } from '../cursorBackend.js'

describe('createCursorBackend', () => {
  const backend = createCursorBackend()

  it('should have correct name, displayName, and cliBinary', () => {
    expect(backend.name).toBe('cursor')
    expect(backend.displayName).toBe('Cursor')
    expect(backend.cliBinary).toBe('cursor')
  })

  it('should declare capabilities', () => {
    expect(backend.capabilities.supportsStreaming).toBe(true)
    expect(backend.capabilities.supportsSessionReuse).toBe(true)
    expect(backend.capabilities.supportsCostTracking).toBe(false)
    expect(backend.capabilities.supportsMcpConfig).toBe(false)
    expect(backend.capabilities.supportsAgentTeams).toBe(false)
  })

  it('should have invoke and checkAvailable methods', () => {
    expect(typeof backend.invoke).toBe('function')
    expect(typeof backend.checkAvailable).toBe('function')
  })
})

describe('cursorBackend checkAvailable', () => {
  it('should return boolean without throwing', async () => {
    const backend = createCursorBackend()
    const available = await backend.checkAvailable()
    expect(typeof available).toBe('boolean')
  })
})
