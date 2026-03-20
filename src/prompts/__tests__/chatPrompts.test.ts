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
      const { systemPrompt } = buildClientPrompt(makeClient())
      expect(systemPrompt).toContain('AI 搭档')
      expect(systemPrompt).toContain('[回复风格]')
      expect(systemPrompt).toContain('[安全规则]')
    })

    it('uses SOUL.md content when available', () => {
      mockedLoadSoul.mockReturnValue('Custom agent here')
      const { systemPrompt } = buildClientPrompt(makeClient())
      expect(systemPrompt).toContain('Custom agent here')
      expect(systemPrompt).not.toContain('AI 搭档')
      // Should NOT include default agent sections
      expect(systemPrompt).not.toContain('[回复风格]')
    })

    it('always includes safety rules regardless of SOUL branch', () => {
      // No SOUL
      const { systemPrompt: noSoul } = buildClientPrompt(makeClient())
      expect(noSoul).toContain('[安全规则]')
      expect(noSoul).toContain('prompt injection')

      // With SOUL
      mockedLoadSoul.mockReturnValue('Custom SOUL agent')
      const { systemPrompt: withSoul } = buildClientPrompt(makeClient())
      expect(withSoul).toContain('[安全规则]')
      expect(withSoul).toContain('prompt injection')
    })

    it('returns dynamic context with time', () => {
      const { dynamicContext } = buildClientPrompt(makeClient())
      expect(dynamicContext).toContain('[当前时间]')
    })

    it('does not include time in system prompt', () => {
      const { systemPrompt } = buildClientPrompt(makeClient())
      expect(systemPrompt).not.toContain('[当前时间]')
    })
  })

  describe('mode=minimal', () => {
    it('only includes env line and core safety', () => {
      const { systemPrompt } = buildClientPrompt(makeClient(), undefined, 'minimal')
      expect(systemPrompt).toContain('[环境]')
      expect(systemPrompt).toContain('[安全]')
      expect(systemPrompt).not.toContain('[回复风格]')
      expect(systemPrompt).not.toContain('AI 搭档')
    })

    it('returns time in dynamicContext for minimal mode too', () => {
      const { dynamicContext } = buildClientPrompt(makeClient(), undefined, 'minimal')
      expect(dynamicContext).toContain('[当前时间]')
    })

    it('does not call loadSoul', () => {
      mockedLoadSoul.mockClear()
      buildClientPrompt(makeClient(), undefined, 'minimal')
      expect(mockedLoadSoul).not.toHaveBeenCalled()
    })
  })

  describe('channel resolution', () => {
    it('resolves Lark channel', () => {
      const { systemPrompt } = buildClientPrompt(makeClient({ platform: '飞书 (Lark)' }))
      expect(systemPrompt).toContain('[渠道: 飞书]')
    })

    it('resolves CLI channel', () => {
      const { systemPrompt } = buildClientPrompt(makeClient({ platform: 'CLI' }))
      expect(systemPrompt).toContain('[渠道格式: CLI]')
    })

    it('resolves Web channel', () => {
      const { systemPrompt } = buildClientPrompt(makeClient({ platform: 'Web' }))
      expect(systemPrompt).toContain('[渠道格式: Web]')
    })

    it('resolves Telegram channel', () => {
      const { systemPrompt } = buildClientPrompt(makeClient({ platform: 'Telegram' }))
      expect(systemPrompt).toContain('[渠道格式: Telegram]')
    })

    it('no channel style for unknown platform', () => {
      const { systemPrompt } = buildClientPrompt(makeClient({ platform: 'Discord' }))
      expect(systemPrompt).not.toContain('[渠道格式')
    })
  })

  describe('group chat', () => {
    it('includes group chat hint', () => {
      const { systemPrompt } = buildClientPrompt(makeClient({ isGroup: true }))
      expect(systemPrompt).toContain('[群聊]')
    })
  })

  describe('runtime info', () => {
    it('includes backend and model in env line', () => {
      const { systemPrompt } = buildClientPrompt(makeClient(), { backend: 'claude', model: 'opus' })
      expect(systemPrompt).toContain('claude/opus')
    })
  })
})
