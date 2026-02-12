/**
 * messageRouter 测试 — 图片消息路由
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routeMessage, parseCommandText, type RouteMessageOptions } from '../messageRouter.js'
import type { MessengerAdapter, ClientContext } from '../types.js'

// Mock dependencies
vi.mock('../approvalHandler.js', () => ({
  parseApprovalCommand: vi.fn(() => null),
  handleApproval: vi.fn(async () => 'approval result'),
}))

vi.mock('../commandHandler.js', () => ({
  handleCommand: vi.fn(async () => ({ text: 'command result' })),
}))

vi.mock('../chatHandler.js', () => ({
  handleChat: vi.fn(async () => {}),
  clearChatSession: vi.fn(() => true),
  getChatSessionInfo: vi.fn(() => null),
  toggleBenchmark: vi.fn(() => true),
}))

function createMockMessenger(): MessengerAdapter {
  return {
    reply: vi.fn(async () => {}),
    sendAndGetId: vi.fn(async () => 'msg-123'),
    editMessage: vi.fn(async () => {}),
    replyCard: vi.fn(async () => {}),
    editCard: vi.fn(async () => {}),
    replyImage: vi.fn(async () => {}),
  }
}

function createMockContext(overrides?: Partial<ClientContext>): ClientContext {
  return {
    platform: '飞书 (Lark)',
    maxMessageLength: 10000,
    supportedFormats: ['markdown', 'code block'],
    isGroup: false,
    ...overrides,
  }
}

describe('parseCommandText', () => {
  it('should return null for non-command text', () => {
    expect(parseCommandText('hello')).toBeNull()
    expect(parseCommandText('just a message')).toBeNull()
  })

  it('should return null for empty text', () => {
    expect(parseCommandText('')).toBeNull()
  })

  it('should parse slash commands', () => {
    expect(parseCommandText('/help')).toEqual({ cmd: '/help', args: '' })
    expect(parseCommandText('/run some task')).toEqual({ cmd: '/run', args: 'some task' })
  })

  it('should strip @mentions before parsing', () => {
    expect(parseCommandText('@Bot /help')).toEqual({ cmd: '/help', args: '' })
    expect(parseCommandText('@MyBot /run task')).toEqual({ cmd: '/run', args: 'task' })
  })
})

describe('routeMessage — image routing', () => {
  let messenger: MessengerAdapter
  let handleChat: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    messenger = createMockMessenger()
    const chatMod = await import('../chatHandler.js')
    handleChat = chatMod.handleChat as ReturnType<typeof vi.fn>
  })

  it('should pass images to handleChat for non-command messages', async () => {
    const options: RouteMessageOptions = {
      chatId: 'chat-001',
      text: '',
      images: ['/tmp/lark-img-001.png'],
      messenger,
      clientContext: createMockContext(),
    }

    await routeMessage(options)

    expect(handleChat).toHaveBeenCalledWith('chat-001', '', messenger, {
      client: expect.objectContaining({ platform: '飞书 (Lark)' }),
      images: ['/tmp/lark-img-001.png'],
    })
  })

  it('should pass multiple images to handleChat', async () => {
    const images = ['/tmp/img-1.png', '/tmp/img-2.png']
    const options: RouteMessageOptions = {
      chatId: 'chat-002',
      text: 'look at these',
      images,
      messenger,
      clientContext: createMockContext(),
    }

    await routeMessage(options)

    expect(handleChat).toHaveBeenCalledWith('chat-002', 'look at these', messenger, {
      client: expect.objectContaining({ platform: '飞书 (Lark)' }),
      images,
    })
  })

  it('should route to chat with empty images array', async () => {
    const options: RouteMessageOptions = {
      chatId: 'chat-003',
      text: 'hello',
      images: [],
      messenger,
      clientContext: createMockContext(),
    }

    await routeMessage(options)

    expect(handleChat).toHaveBeenCalledWith('chat-003', 'hello', messenger, {
      client: expect.objectContaining({ platform: '飞书 (Lark)' }),
      images: [],
    })
  })

  it('should route to chat with undefined images', async () => {
    const options: RouteMessageOptions = {
      chatId: 'chat-004',
      text: 'hello',
      messenger,
      clientContext: createMockContext(),
    }

    await routeMessage(options)

    expect(handleChat).toHaveBeenCalledWith('chat-004', 'hello', messenger, {
      client: expect.objectContaining({ platform: '飞书 (Lark)' }),
      images: undefined,
    })
  })

  it('should still route slash commands normally when images present', async () => {
    const options: RouteMessageOptions = {
      chatId: 'chat-005',
      text: '/new',
      images: ['/tmp/img.png'],
      messenger,
      clientContext: createMockContext(),
    }

    await routeMessage(options)

    // /new should be handled as session command, not go to chat
    expect(handleChat).not.toHaveBeenCalled()
    expect(messenger.reply).toHaveBeenCalledWith('chat-005', '✅ 已开始新对话')
  })
})
