/**
 * chatMemoryExtractor tests — trigger detection and buffer management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock extractChatMemory to track calls without actually invoking AI
const mockExtractChatMemory = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../memory/index.js', () => ({
  extractChatMemory: (...args: unknown[]) => mockExtractChatMemory(...args),
}))

// Mock loadConfig
vi.mock('../../../config/loadConfig.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    memory: {
      chatMemory: {
        extractEveryNTurns: 5,
        triggerKeywords: [],
      },
    },
  }),
}))

// Mock DATA_DIR to avoid filesystem side effects
vi.mock('../../../store/paths.js', () => ({
  DATA_DIR: '/tmp/cah-test-chatmemory',
}))

// Mock fs operations for buffer persistence
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return {
    ...original,
    readFileSync: vi.fn(() => { throw new Error('no file') }),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

import {
  triggerChatMemoryExtraction,
  clearChatMemoryBuffers,
  resetExtractConfigCache,
} from '../chatMemoryExtractor.js'

describe('chatMemoryExtractor — trigger detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearChatMemoryBuffers()
    resetExtractConfigCache()
  })

  it('@iflow 分析架构 → triggers immediate extraction (backend-switch)', async () => {
    const result = triggerChatMemoryExtraction('chat-1', '@iflow 分析架构', 'AI response', 'lark')

    // Synchronous return: REMEMBER_KEYWORDS not matched, so false
    expect(result).toBe(false)

    // Wait for async config load + extraction trigger
    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })

    // Check the messages passed to extraction include the user text
    const [messages, opts] = mockExtractChatMemory.mock.calls[0]!
    expect(messages).toEqual([
      { role: 'user', text: '@iflow 分析架构' },
      { role: 'assistant', text: 'AI response' },
    ])
    expect(opts.chatId).toBe('chat-1')
  })

  it('决定用 pnpm 而不是 npm → triggers via decision keyword', async () => {
    triggerChatMemoryExtraction('chat-2', '决定用 pnpm 而不是 npm', 'OK', 'lark')

    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })
  })

  it('记住，测试前先跑 typecheck 很重要 → triggers via remember keyword (high priority)', async () => {
    // Both REMEMBER_KEYWORDS (记住) and EMPHASIS_KEYWORDS (重要) match
    const result = triggerChatMemoryExtraction(
      'chat-3',
      '记住，测试前先跑 typecheck 很重要',
      'I will remember',
      'lark',
    )

    // Synchronous: REMEMBER_KEYWORDS matched
    expect(result).toBe(true)

    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })
  })

  it('long message (>200 chars) → triggers extraction', async () => {
    const longText = '这是一段很长的消息，'.repeat(25) // well over 200 chars
    expect(longText.length).toBeGreaterThan(200)

    triggerChatMemoryExtraction('chat-4', longText, 'Got it', 'lark')

    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })
  })

  it('normal short message without keywords → does NOT trigger immediate extraction', async () => {
    triggerChatMemoryExtraction('chat-5', '你好', '你好！', 'lark')

    // Give async a chance to run
    await new Promise(r => setTimeout(r, 50))
    expect(mockExtractChatMemory).not.toHaveBeenCalled()
  })

  it('periodic trigger fires after N turns (default 5)', async () => {
    const chatId = 'chat-periodic'

    // Send 4 normal turns — should not trigger
    for (let i = 0; i < 4; i++) {
      triggerChatMemoryExtraction(chatId, `message ${i}`, `reply ${i}`, 'lark')
    }
    await new Promise(r => setTimeout(r, 50))
    expect(mockExtractChatMemory).not.toHaveBeenCalled()

    // 5th turn should trigger periodic extraction
    triggerChatMemoryExtraction(chatId, 'message 4', 'reply 4', 'lark')
    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })

    // Buffer should contain all 5 turns (10 messages)
    const [messages] = mockExtractChatMemory.mock.calls[0]!
    expect(messages).toHaveLength(10)
  })

  it('correction keywords trigger extraction', async () => {
    triggerChatMemoryExtraction('chat-6', '不要用 npm，用 pnpm', 'OK', 'lark')

    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })
  })

  it('emphasis keywords trigger extraction', async () => {
    triggerChatMemoryExtraction('chat-7', 'this is important for the project', 'Noted', 'lark')

    await vi.waitFor(() => {
      expect(mockExtractChatMemory).toHaveBeenCalledTimes(1)
    })
  })
})
