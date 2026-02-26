/**
 * chatHandler 测试 — 图片消息处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessengerAdapter, ClientContext } from '../types.js'

// Mock backend
const mockInvokeBackend = vi.fn()
vi.mock('../../../backend/index.js', () => ({
  invokeBackend: (...args: unknown[]) => mockInvokeBackend(...args),
}))

// Mock conversation log
const mockLogConversation = vi.fn()
vi.mock('../conversationLog.js', () => ({
  logConversation: (...args: unknown[]) => mockLogConversation(...args),
  getRecentConversations: () => [],
}))

// Mock prompts
vi.mock('../../../prompts/chatPrompts.js', () => ({
  buildClientPrompt: vi.fn(() => '[client context]'),
  wrapMemoryContext: (s: string) => s || '',
  wrapHistoryContext: (s: string) => s || '',
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

describe('chatHandler — image handling', () => {
  let handleChat: typeof import('../chatHandler.js').handleChat
  let messenger: MessengerAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    messenger = createMockMessenger()

    // Default successful backend response
    mockInvokeBackend.mockResolvedValue({
      ok: true,
      value: {
        response: 'I can see the image!',
        sessionId: 'session-001',
      },
    })

    // Dynamic import to get fresh module with mocks applied
    const mod = await import('../chatHandler.js')
    handleChat = mod.handleChat
  })

  it('should send image placeholder when images are provided', async () => {
    await handleChat('chat-001', '', messenger, {
      client: createClientContext(),
      images: ['/tmp/lark-img-001.png'],
    })

    // Should send "已收到图片" placeholder instead of "思考中"
    expect(messenger.sendAndGetId).toHaveBeenCalledWith('chat-001', '🖼️ 已收到图片，分析中...')
  })

  it('should send thinking placeholder when no images', async () => {
    await handleChat('chat-002', 'hello', messenger, {
      client: createClientContext(),
    })

    expect(messenger.sendAndGetId).toHaveBeenCalledWith('chat-002', '🤔 思考中...')
  })

  it('should inject image paths into prompt', async () => {
    await handleChat('chat-003', 'what is this', messenger, {
      client: createClientContext(),
      images: ['/tmp/lark-img-test.png'],
    })

    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('/tmp/lark-img-test.png'),
      })
    )
    // Should include the Read tool instruction
    expect(mockInvokeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Read 工具查看后回复'),
      })
    )
  })

  it('should inject multiple image paths into prompt', async () => {
    const images = ['/tmp/img-1.png', '/tmp/img-2.png']
    await handleChat('chat-004', '', messenger, {
      client: createClientContext(),
      images,
    })

    const call = mockInvokeBackend.mock.calls[0]![0]
    expect(call.prompt).toContain('/tmp/img-1.png')
    expect(call.prompt).toContain('/tmp/img-2.png')
  })

  it('should log images in conversation entry', async () => {
    const images = ['/tmp/lark-img-log.png']
    await handleChat('chat-005', '', messenger, {
      client: createClientContext(),
      images,
    })

    // First call should be the "in" (user message) log
    expect(mockLogConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: 'in',
        chatId: 'chat-005',
        images,
      })
    )
  })

  it('should log "[图片消息]" as text when image with no text', async () => {
    await handleChat('chat-006', '', messenger, {
      client: createClientContext(),
      images: ['/tmp/img.png'],
    })

    expect(mockLogConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: 'in',
        text: '[图片消息]',
      })
    )
  })

  it('should handle backend error gracefully with images', async () => {
    mockInvokeBackend.mockResolvedValue({
      ok: false,
      error: { message: 'backend down' },
    })

    await handleChat('chat-007', '', messenger, {
      client: createClientContext(),
      images: ['/tmp/img.png'],
    })

    // Should edit placeholder with error message
    expect(messenger.editMessage).toHaveBeenCalledWith(
      'chat-007',
      'placeholder-msg-id',
      expect.stringContaining('AI 调用失败')
    )
  })

  it('should work with text + images combined', async () => {
    await handleChat('chat-008', 'analyze this chart', messenger, {
      client: createClientContext(),
      images: ['/tmp/chart.png'],
    })

    const call = mockInvokeBackend.mock.calls[0]![0]
    // Should have both user text and image reference
    expect(call.prompt).toContain('analyze this chart')
    expect(call.prompt).toContain('/tmp/chart.png')
  })
})
