import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'

// Must set DATA_DIR before importing loadSoul
const tmpDir = join(process.env.CAH_DATA_DIR || '/tmp/cah-test', 'soul-test-' + Date.now())
vi.stubEnv('CAH_DATA_DIR', tmpDir)

// Dynamic import to pick up stubbed env
let loadSoul: () => string | null

beforeEach(async () => {
  mkdirSync(tmpDir, { recursive: true })
  // Re-import fresh module each test to reset cache
  vi.resetModules()
  const mod = await import('../loadSoul.js')
  loadSoul = mod.loadSoul
})

afterEach(() => {
  const soulFile = join(tmpDir, 'SOUL.md')
  if (existsSync(soulFile)) unlinkSync(soulFile)
})

describe('loadSoul', () => {
  it('returns null when SOUL.md does not exist', () => {
    expect(loadSoul()).toBeNull()
  })

  it('returns content when SOUL.md exists', () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'Hello World')
    expect(loadSoul()).toBe('Hello World')
  })

  it('returns null when SOUL.md is empty', () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), '   ')
    expect(loadSoul()).toBeNull()
  })

  it('returns cached content on repeated calls within TTL', () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'v1')
    expect(loadSoul()).toBe('v1')
    // Change file content but within TTL window — should still return cached
    writeFileSync(join(tmpDir, 'SOUL.md'), 'v2')
    expect(loadSoul()).toBe('v1') // still cached
  })

  it('returns null after file deletion (once TTL expires)', async () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'exists')
    expect(loadSoul()).toBe('exists')

    unlinkSync(join(tmpDir, 'SOUL.md'))

    // Force TTL expiry by re-importing (resets cache)
    vi.resetModules()
    const mod = await import('../loadSoul.js')
    expect(mod.loadSoul()).toBeNull()
  })
})
