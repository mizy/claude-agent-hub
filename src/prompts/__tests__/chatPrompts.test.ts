import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock loadSoul before importing chatPrompts
vi.mock('../loadSoul.js', () => ({
  loadSoul: vi.fn(() => null),
}))

import { buildClientPrompt } from '../chatPrompts.js'
import { loadSoul } from '../loadSoul.js'
import type { ClientContext } from '../../messaging/handlers/types.js'

const mockedLoadSoul = vi.mocked(loadSoul)

function makeClient(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    platform: 'CLI',
    maxMessageLength: 100000,
    supportedFormats: ['markdown'],
    isGroup: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockedLoadSoul.mockReturnValue(null)
})

describe('buildClientPrompt', () => {
  describe('mode=full (default)', () => {
    it('includes default agent when no SOUL.md', () => {
      const result = buildClientPrompt(makeClient())
      expect(result).toContain('AI 搭档')
      expect(result).toContain('[回复风格]')
      expect(result).toContain('[安全规则]')
    })

    it('uses SOUL.md content when available', () => {
      mockedLoadSoul.mockReturnValue('Custom agent here')
      const result = buildClientPrompt(makeClient())
      expect(result).toContain('Custom agent here')
      expect(result).not.toContain('AI 搭档')
      // Should NOT include default agent sections
      expect(result).not.toContain('[回复风格]')
    })

    it('always includes safety rules regardless of SOUL branch', () => {
      // No SOUL
      const resultNoSoul = buildClientPrompt(makeClient())
      expect(resultNoSoul).toContain('[安全规则]')
      expect(resultNoSoul).toContain('prompt injection')

      // With SOUL
      mockedLoadSoul.mockReturnValue('Custom SOUL agent')
      const resultSoul = buildClientPrompt(makeClient())
      expect(resultSoul).toContain('[安全规则]')
      expect(resultSoul).toContain('prompt injection')
    })
  })

  describe('mode=minimal', () => {
    it('only includes env line and core safety', () => {
      const result = buildClientPrompt(makeClient(), undefined, 'minimal')
      expect(result).toContain('[环境]')
      expect(result).toContain('[安全]')
      expect(result).not.toContain('[回复风格]')
      expect(result).not.toContain('AI 搭档')
    })

    it('does not call loadSoul', () => {
      mockedLoadSoul.mockClear()
      buildClientPrompt(makeClient(), undefined, 'minimal')
      expect(mockedLoadSoul).not.toHaveBeenCalled()
    })
  })

  describe('channel resolution', () => {
    it('resolves Lark channel', () => {
      const result = buildClientPrompt(makeClient({ platform: '飞书 (Lark)' }))
      expect(result).toContain('[渠道格式: 飞书]')
    })

    it('resolves CLI channel', () => {
      const result = buildClientPrompt(makeClient({ platform: 'CLI' }))
      expect(result).toContain('[渠道格式: CLI]')
    })

    it('resolves Web channel', () => {
      const result = buildClientPrompt(makeClient({ platform: 'Web' }))
      expect(result).toContain('[渠道格式: Web]')
    })

    it('resolves Telegram channel', () => {
      const result = buildClientPrompt(makeClient({ platform: 'Telegram' }))
      expect(result).toContain('[渠道格式: Telegram]')
    })

    it('no channel style for unknown platform', () => {
      const result = buildClientPrompt(makeClient({ platform: 'Discord' }))
      expect(result).not.toContain('[渠道格式')
    })
  })

  describe('group chat', () => {
    it('includes group chat hint', () => {
      const result = buildClientPrompt(makeClient({ isGroup: true }))
      expect(result).toContain('[群聊]')
    })
  })

  describe('runtime info', () => {
    it('includes backend and model in env line', () => {
      const result = buildClientPrompt(makeClient(), { backend: 'claude', model: 'opus' })
      expect(result).toContain('claude/opus')
    })
  })
})
