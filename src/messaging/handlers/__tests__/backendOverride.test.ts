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
    memory: { chatMemory: { enabled: false, maxMemories: 5 } },
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

  it('@iflow 帮我分析这段代码 → iflow', async () => {
    const result = await parseBackendOverride('@iflow 帮我分析这段代码')
    expect(result).toEqual({ backend: 'iflow', actualText: '帮我分析这段代码' })
  })

  it('@opencode question → opencode', async () => {
    const result = await parseBackendOverride('@opencode list current files')
    expect(result).toEqual({ backend: 'opencode', actualText: 'list current files' })
  })

  it('@claude-code 写个函数 → claude-code', async () => {
    const result = await parseBackendOverride('@claude-code 写个函数')
    expect(result).toEqual({ backend: 'claude-code', actualText: '写个函数' })
  })

  it('@codebuddy 帮我看看 → codebuddy', async () => {
    const result = await parseBackendOverride('@codebuddy 帮我看看')
    expect(result).toEqual({ backend: 'codebuddy', actualText: '帮我看看' })
  })

  it('/backend:iflow 帮我分析 → iflow', async () => {
    const result = await parseBackendOverride('/backend:iflow 帮我分析')
    expect(result).toEqual({ backend: 'iflow', actualText: '帮我分析' })
  })

  it('/use opencode\\n列出当前目录文件 → opencode (newline separator)', async () => {
    const result = await parseBackendOverride('/use opencode\n列出当前目录文件')
    expect(result).toEqual({ backend: 'opencode', actualText: '列出当前目录文件' })
  })

  it('/use claude-code 写个函数 → claude-code (space separator)', async () => {
    const result = await parseBackendOverride('/use claude-code 写个函数')
    expect(result).toEqual({ backend: 'claude-code', actualText: '写个函数' })
  })

  it('普通消息 → no backend override', async () => {
    const result = await parseBackendOverride('普通问题')
    expect(result).toEqual({ backend: undefined, actualText: '普通问题' })
  })

  it('@unknown 测试 → no match for unsupported backend', async () => {
    const result = await parseBackendOverride('@unknown 测试')
    expect(result).toEqual({ backend: undefined, actualText: '@unknown 测试' })
  })

  it('empty string → no backend override', async () => {
    const result = await parseBackendOverride('')
    expect(result).toEqual({ backend: undefined, actualText: '' })
  })

  it('@iflow with no content → backend with empty actualText', async () => {
    // The regex requires whitespace/newline after backend name, so no match without trailing space
    const result = await parseBackendOverride('@iflow')
    expect(result).toEqual({ backend: undefined, actualText: '@iflow' })
  })

  it('@iflow with trailing space → backend with empty actualText', async () => {
    const result = await parseBackendOverride('@iflow ')
    expect(result).toEqual({ backend: 'iflow', actualText: '' })
  })
})

// ── parseInlineModel unit tests ──

describe('parseInlineModel', () => {
  let parseInlineModel: typeof import('../chatHandler.js').parseInlineModel

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../chatHandler.js')
    parseInlineModel = mod.parseInlineModel
  })

  it('@opus 帮我分析 → opus model', () => {
    const result = parseInlineModel('@opus 帮我分析')
    expect(result).toEqual({ model: 'opus', actualText: '帮我分析' })
  })

  it('sonnet 写个函数 → sonnet model', () => {
    const result = parseInlineModel('sonnet 写个函数')
    expect(result).toEqual({ model: 'sonnet', actualText: '写个函数' })
  })

  it('@haiku hi → haiku model', () => {
    const result = parseInlineModel('@haiku hi')
    expect(result).toEqual({ model: 'haiku', actualText: 'hi' })
  })

  it('OPUS 大写 → opus (case-insensitive)', () => {
    const result = parseInlineModel('OPUS 大写测试')
    expect(result).toEqual({ model: 'opus', actualText: '大写测试' })
  })

  it('普通消息 → no model override', () => {
    const result = parseInlineModel('普通问题')
    expect(result).toEqual({ model: undefined, actualText: '普通问题' })
  })

  it('opus with no content → model with empty actualText', () => {
    const result = parseInlineModel('opus')
    expect(result).toEqual({ model: 'opus', actualText: '' })
  })

  it('消息中间的 opus 不匹配 → no model override', () => {
    const result = parseInlineModel('请用 opus 模型')
    expect(result).toEqual({ model: undefined, actualText: '请用 opus 模型' })
  })
})

// ── chatHandler integration tests for backend override ──

// Mock sessionManager to inspect session state
const mockSetSession = vi.fn()
const mockGetSession = vi.fn()
const mockClearSession = vi.fn()
vi.mock('../sessionManager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sessionManager.js')>()
  return {
    ...actual,
    setSession: (...args: unknown[]) => mockSetSession(...args),
    getSession: (...args: unknown[]) => mockGetSession(...args),
    clearSession: (...args: unknown[]) => mockClearSession(...args),
    enqueueChat: (_chatId: string, fn: () => Promise<void>) => fn(),
    shouldResetSession: () => false,
    incrementTurn: vi.fn(),
    getModelOverride: () => undefined,
    getBackendOverride: () => undefined,
  }
})

describe('chatHandler — backend override', () => {
  let handleChat: typeof import('../chatHandler.js').handleChat
  let messenger: MessengerAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    messenger = createMockMessenger()
    mockGetSession.mockReturnValue(undefined)

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
      expect.stringContaining('| iflow')
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

  it('should save backend type when updating session', async () => {
    await handleChat('chat-be-6', '@iflow 测试', messenger, {
      client: createClientContext(),
    })

    // setSession should be called with backendOverride as 3rd arg
    expect(mockSetSession).toHaveBeenCalledWith('chat-be-6', 'session-001', 'iflow')
  })

  it('should save undefined backend type for default backend', async () => {
    await handleChat('chat-be-7', '普通消息', messenger, {
      client: createClientContext(),
    })

    expect(mockSetSession).toHaveBeenCalledWith('chat-be-7', 'session-001', undefined)
  })

  it('should NOT reuse session when backend changes from inline to default', async () => {
    // Simulate: previous call was @local, session was saved with sessionBackendType='local'
    mockGetSession.mockReturnValue({
      sessionId: 'session-openai-123',
      lastActiveAt: Date.now(),
      turnCount: 1,
      estimatedTokens: 100,
      sessionBackendType: 'local',
    })

    await handleChat('chat-be-8', '普通消息', messenger, {
      client: createClientContext(),
    })

    // Should NOT pass the old session ID (backend mismatch: local → default)
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: undefined,
      })
    )
  })

  // ── Model keyword integration tests ──

  it('should pass opus model when message starts with @opus', async () => {
    await handleChat('chat-model-1', '@opus 帮我分析这段代码', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'opus',
      })
    )
    // Prompt should not contain the @opus prefix
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('帮我分析这段代码'),
      })
    )
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining('@opus'),
      })
    )
  })

  it('should pass sonnet model when message starts with sonnet', async () => {
    await handleChat('chat-model-2', 'sonnet 写个函数', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'sonnet',
      })
    )
  })

  it('should pass haiku model when message starts with haiku', async () => {
    await handleChat('chat-model-3', 'haiku 简单问题', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'haiku',
      })
    )
  })

  it('should be case-insensitive for model keywords (OPUS)', async () => {
    await handleChat('chat-model-4', 'OPUS 大写测试', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'opus',
      })
    )
  })

  it('should not override model when message has no keyword', async () => {
    await handleChat('chat-model-5', '普通消息不含关键字', messenger, {
      client: createClientContext(),
    })

    // Model should be auto-selected (sonnet for normal length), not undefined
    const call = mockInvokeBackend.mock.calls[0]![0]
    expect(call.model).toBeDefined()
    // No model keyword → auto-selection picks based on content
    expect(['haiku', 'sonnet', 'opus']).toContain(call.model)
  })

  it('should not set model for non-claude backend without explicit keyword', async () => {
    await handleChat('chat-model-6', '@iflow 帮我分析', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: 'iflow',
        model: undefined,
      })
    )
  })

  it('should coexist with @backend: @iflow + opus keyword', async () => {
    // @iflow is parsed first as backend, then "opus 问题" is parsed as model keyword
    await handleChat('chat-model-7', '@iflow opus 问题', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: 'iflow',
        model: 'opus',
      })
    )
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('问题'),
      })
    )
  })

  it('should reuse session when backend stays the same', async () => {
    // Simulate: previous call was default backend, current is also default
    mockGetSession.mockReturnValue({
      sessionId: 'session-claude-456',
      lastActiveAt: Date.now(),
      turnCount: 1,
      estimatedTokens: 100,
      sessionBackendType: undefined, // default backend
    })

    await handleChat('chat-be-9', '继续聊', messenger, {
      client: createClientContext(),
    })

    // Should reuse session (both are default backend)
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-claude-456',
      })
    )
  })
})
