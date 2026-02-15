/**
 * Tests for dynamic backend switching via message directives and session commands
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessengerAdapter, ClientContext } from '../types.js'

// Mock getRegisteredBackends — must be before any import that uses it
vi.mock('../../../backend/resolveBackend.js', () => ({
  getRegisteredBackends: () => ['claude-code', 'opencode', 'iflow', 'codebuddy'],
}))

// Mock backend
const mockInvokeBackend = vi.fn()
vi.mock('../../../backend/index.js', () => ({
  invokeBackend: (...args: unknown[]) => mockInvokeBackend(...args),
}))

// Mock conversation log
vi.mock('../conversationLog.js', () => ({
  logConversation: vi.fn(),
  getRecentConversations: () => [],
}))

// Mock prompts
vi.mock('../../../prompts/chatPrompts.js', () => ({
  buildClientPrompt: vi.fn(() => '[client context]'),
}))

// Mock config
vi.mock('../../../config/loadConfig.js', () => ({
  loadConfig: vi.fn(async () => ({
    backend: { chat: { mcpServers: [] } },
  })),
}))

function createMockMessenger(): MessengerAdapter {
  return {
    reply: vi.fn(async () => {}),
    sendAndGetId: vi.fn(async () => 'placeholder-msg-id'),
    editMessage: vi.fn(async () => {}),
    replyImage: vi.fn(async () => {}),
  }
}

function createClientContext(): ClientContext {
  return {
    platform: '飞书 (Lark)',
    maxMessageLength: 10000,
    supportedFormats: ['markdown'],
    isGroup: false,
  }
}

// ── parseBackendOverride unit tests ──

describe('parseBackendOverride', () => {
  let parseBackendOverride: typeof import('../chatHandler.js').parseBackendOverride

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../chatHandler.js')
    parseBackendOverride = mod.parseBackendOverride
  })

  it('@iflow 帮我分析这段代码 → iflow', () => {
    const result = parseBackendOverride('@iflow 帮我分析这段代码')
    expect(result).toEqual({ backend: 'iflow', actualText: '帮我分析这段代码' })
  })

  it('@opencode question → opencode', () => {
    const result = parseBackendOverride('@opencode list current files')
    expect(result).toEqual({ backend: 'opencode', actualText: 'list current files' })
  })

  it('@claude-code 写个函数 → claude-code', () => {
    const result = parseBackendOverride('@claude-code 写个函数')
    expect(result).toEqual({ backend: 'claude-code', actualText: '写个函数' })
  })

  it('@codebuddy 帮我看看 → codebuddy', () => {
    const result = parseBackendOverride('@codebuddy 帮我看看')
    expect(result).toEqual({ backend: 'codebuddy', actualText: '帮我看看' })
  })

  it('/backend:iflow 帮我分析 → iflow', () => {
    const result = parseBackendOverride('/backend:iflow 帮我分析')
    expect(result).toEqual({ backend: 'iflow', actualText: '帮我分析' })
  })

  it('/use opencode\\n列出当前目录文件 → opencode (newline separator)', () => {
    const result = parseBackendOverride('/use opencode\n列出当前目录文件')
    expect(result).toEqual({ backend: 'opencode', actualText: '列出当前目录文件' })
  })

  it('/use claude-code 写个函数 → claude-code (space separator)', () => {
    const result = parseBackendOverride('/use claude-code 写个函数')
    expect(result).toEqual({ backend: 'claude-code', actualText: '写个函数' })
  })

  it('普通消息 → no backend override', () => {
    const result = parseBackendOverride('普通问题')
    expect(result).toEqual({ backend: undefined, actualText: '普通问题' })
  })

  it('@unknown 测试 → no match for unsupported backend', () => {
    const result = parseBackendOverride('@unknown 测试')
    expect(result).toEqual({ backend: undefined, actualText: '@unknown 测试' })
  })

  it('empty string → no backend override', () => {
    const result = parseBackendOverride('')
    expect(result).toEqual({ backend: undefined, actualText: '' })
  })

  it('@iflow with no content → backend with empty actualText', () => {
    // The regex requires whitespace/newline after backend name, so no match without trailing space
    const result = parseBackendOverride('@iflow')
    expect(result).toEqual({ backend: undefined, actualText: '@iflow' })
  })

  it('@iflow with trailing space → backend with empty actualText', () => {
    const result = parseBackendOverride('@iflow ')
    expect(result).toEqual({ backend: 'iflow', actualText: '' })
  })
})

// ── chatHandler integration tests for backend override ──

describe('chatHandler — backend override', () => {
  let handleChat: typeof import('../chatHandler.js').handleChat
  let messenger: MessengerAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    messenger = createMockMessenger()

    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: {
        response: 'test response',
        sessionId: 'session-001',
      },
    })

    const mod = await import('../chatHandler.js')
    handleChat = mod.handleChat
  })

  it('should pass inline backend directive to invokeBackend', async () => {
    await handleChat('chat-be-1', '@iflow 帮我分析这段代码', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: 'iflow',
      })
    )
    // Prompt should contain the actual text without the @iflow prefix
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('帮我分析这段代码'),
      })
    )
  })

  it('should not pass backendType for plain messages', async () => {
    await handleChat('chat-be-2', '普通消息', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: undefined,
      })
    )
  })

  it('should include backend label in completion marker', async () => {
    await handleChat('chat-be-3', '@iflow 测试', messenger, {
      client: createClientContext(),
    })

    // The final response should include [iflow] label
    expect(messenger.editMessage).toHaveBeenCalledWith(
      'chat-be-3',
      'placeholder-msg-id',
      expect.stringContaining('[iflow]')
    )
  })

  it('should NOT include backend label for default backend', async () => {
    await handleChat('chat-be-4', '普通消息', messenger, {
      client: createClientContext(),
    })

    // Should not contain any backend label in brackets
    const editCalls = (messenger.editMessage as ReturnType<typeof vi.fn>).mock.calls
    if (editCalls.length > 0) {
      const finalText = editCalls[editCalls.length - 1]![2] as string
      expect(finalText).not.toMatch(/\[(?:claude-code|opencode|iflow|codebuddy)\]/)
    }
  })

  it('should handle /use directive', async () => {
    await handleChat('chat-be-5', '/use opencode\n列出文件', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: 'opencode',
      })
    )
  })
})
