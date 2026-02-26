/**
 * chatHandler tests — memory retrieval and injection into prompt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessengerAdapter, ClientContext } from '../types.js'

// Mock backend
const mockInvokeBackend = vi.fn()
vi.mock('../../../backend/index.js', () => ({
  invokeBackend: (...args: unknown[]) => mockInvokeBackend(...args),
}))

// Mock memory — the core module under test
const mockRetrieveAllMemoryContext = vi.fn()
vi.mock('../../../memory/index.js', () => ({
  retrieveAllMemoryContext: (...args: unknown[]) => mockRetrieveAllMemoryContext(...args),
  addMemory: vi.fn(),
}))

// Mock conversation log
const mockLogConversation = vi.fn()
vi.mock('../conversationLog.js', () => ({
  logConversation: (...args: unknown[]) => mockLogConversation(...args),
  getRecentConversations: () => [],
}))

// Mock prompts
vi.mock('../../../prompts/chatPrompts.js', () => ({
  buildClientPrompt: vi.fn(() => '[client]'),
  wrapMemoryContext: (s: string) => s || '',
  wrapHistoryContext: (s: string) => s || '',
}))

// Mock session manager
vi.mock('../sessionManager.js', () => ({
  getSession: vi.fn(() => null),
  setSession: vi.fn(),
  clearSession: vi.fn(),
  enqueueChat: vi.fn((_chatId: string, fn: () => Promise<void>) => fn()),
  destroySessions: vi.fn(),
  getModelOverride: vi.fn(() => null),
  getBackendOverride: vi.fn(() => null),
  shouldResetSession: vi.fn(() => false),
  incrementTurn: vi.fn(),
}))

// Mock streaming handler
vi.mock('../streamingHandler.js', () => ({
  createStreamHandler: vi.fn(() => ({
    onChunk: vi.fn(),
    stop: vi.fn(),
  })),
  sendFinalResponse: vi.fn(),
}))

// Mock image extractor
vi.mock('../imageExtractor.js', () => ({
  sendDetectedImages: vi.fn(),
}))

// Mock chat memory extractor
vi.mock('../chatMemoryExtractor.js', () => ({
  triggerChatMemoryExtraction: vi.fn(),
}))

// Mock episode extractor
vi.mock('../episodeExtractor.js', () => ({
  trackEpisodeTurn: vi.fn(),
  destroyEpisodeTrackers: vi.fn(),
  flushEpisode: vi.fn(),
}))

// Mock resolveBackend
vi.mock('../../../backend/resolveBackend.js', () => ({
  getRegisteredBackends: vi.fn(() => ['claude-code']),
}))

// Mock loadConfig with memory enabled
vi.mock('../../../config/loadConfig.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    memory: {
      chatMemory: { enabled: true, maxMemories: 5, extractEveryNTurns: 5, triggerKeywords: [] },
      episodic: { enabled: true },
    },
    backend: { chat: { mcpServers: [] } },
    backends: {},
  }),
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

describe('chatHandler — memory injection', () => {
  let handleChat: typeof import('../chatHandler.js').handleChat
  let messenger: MessengerAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    messenger = createMockMessenger()

    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: { response: 'AI response', sessionId: 'session-001' },
    })

    // Default: no memory context
    mockRetrieveAllMemoryContext.mockResolvedValue('')

    const mod = await import('../chatHandler.js')
    handleChat = mod.handleChat
  })

  it('injects memory context into prompt when retrieval returns content', async () => {
    const memoryContent = '## 记忆上下文\n\n### 最佳实践\n- 使用 pnpm 而非 npm'
    mockRetrieveAllMemoryContext.mockResolvedValue(memoryContent)

    await handleChat('chat-mem-1', '如何安装依赖', messenger, {
      client: createClientContext(),
    })

    // Memory should be injected into the prompt
    const call = mockInvokeBackend.mock.calls[0]![0]
    expect(call.prompt).toContain(memoryContent)
    // Order: clientPrefix + memoryContext + historyContext + effectiveText
    expect(call.prompt).toContain('如何安装依赖')
  })

  it('does not inject memory when retrieval returns empty string', async () => {
    mockRetrieveAllMemoryContext.mockResolvedValue('')

    await handleChat('chat-mem-2', 'hello', messenger, {
      client: createClientContext(),
    })

    const call = mockInvokeBackend.mock.calls[0]![0]
    // Prompt should just be client prefix + text, no double newlines from empty memory
    expect(call.prompt).not.toContain('## 记忆上下文')
  })

  it('continues normally when retrieveAllMemoryContext throws', async () => {
    mockRetrieveAllMemoryContext.mockRejectedValue(new Error('memory store corrupted'))

    await handleChat('chat-mem-3', 'tell me a joke', messenger, {
      client: createClientContext(),
    })

    // Backend should still be called despite memory failure
    expect(mockInvokeBackend).toHaveBeenCalledTimes(1)
    const call = mockInvokeBackend.mock.calls[0]![0]
    expect(call.prompt).toContain('tell me a joke')
    // No memory content in prompt
    expect(call.prompt).not.toContain('记忆上下文')
  })

  it('skips memory retrieval when effectiveText is empty', async () => {
    await handleChat('chat-mem-4', '', messenger, {
      client: createClientContext(),
      images: ['/tmp/img.png'],
    })

    // retrieveAllMemoryContext should not be called for empty text
    expect(mockRetrieveAllMemoryContext).not.toHaveBeenCalled()
  })

  it('passes maxMemories option to retrieveAllMemoryContext', async () => {
    mockRetrieveAllMemoryContext.mockResolvedValue('## 记忆上下文\n- something')

    await handleChat('chat-mem-5', 'query text', messenger, {
      client: createClientContext(),
    })

    // Verify maxResults is passed from config
    expect(mockRetrieveAllMemoryContext).toHaveBeenCalledWith('query text', {
      maxResults: expect.any(Number),
    })
  })

  it('places memory context before user text in prompt', async () => {
    const memoryContent = '## 记忆上下文\n\n### 经验教训\n- 先跑 typecheck'
    mockRetrieveAllMemoryContext.mockResolvedValue(memoryContent)

    await handleChat('chat-mem-6', '帮我检查代码', messenger, {
      client: createClientContext(),
    })

    const call = mockInvokeBackend.mock.calls[0]![0]
    const prompt: string = call.prompt
    const memoryIdx = prompt.indexOf('记忆上下文')
    const textIdx = prompt.indexOf('帮我检查代码')
    // Memory should appear before user text
    expect(memoryIdx).toBeLessThan(textIdx)
    expect(memoryIdx).toBeGreaterThan(-1)
  })

  it('handles null return from retrieveAllMemoryContext gracefully', async () => {
    mockRetrieveAllMemoryContext.mockResolvedValue(null)

    await handleChat('chat-mem-7', 'test query', messenger, {
      client: createClientContext(),
    })

    expect(mockInvokeBackend).toHaveBeenCalledTimes(1)
    const call = mockInvokeBackend.mock.calls[0]![0]
    expect(call.prompt).toContain('test query')
  })
})
