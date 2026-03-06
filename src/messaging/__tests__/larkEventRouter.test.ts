/**
 * larkEventRouter — file download, quoted message, and audio message tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessengerAdapter } from '../handlers/types.js'

// ── fs mock ──

const mockStatSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockUnlinkSync = vi.fn()

vi.mock('fs', () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}))

// ── store/paths mock — use importOriginal to preserve all exports ──

vi.mock('../../store/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/paths.js')>()
  return {
    ...actual,
    DATA_DIR: '/tmp/cah-test',
  }
})

// ── dedup mock ──

const mockIsDuplicateMessage = vi.fn().mockReturnValue(false)
const mockIsStaleMessage = vi.fn().mockReturnValue(false)
const mockIsDuplicateContent = vi.fn().mockReturnValue(false)

vi.mock('../larkMessageDedup.js', () => ({
  isDuplicateMessage: (...args: unknown[]) => mockIsDuplicateMessage(...args),
  isStaleMessage: (...args: unknown[]) => mockIsStaleMessage(...args),
  isDuplicateContent: (...args: unknown[]) => mockIsDuplicateContent(...args),
  markDaemonStarted: vi.fn(),
}))

// ── routeMessage mock (called inside handleLarkMessage) ──

const mockRouteMessage = vi.fn().mockResolvedValue(undefined)
vi.mock('../handlers/messageRouter.js', () => ({
  routeMessage: (...args: unknown[]) => mockRouteMessage(...args),
}))

// ── Lark config / approval mock ──

vi.mock('../../config/index.js', () => ({
  getLarkConfig: vi.fn().mockResolvedValue(null),
}))

vi.mock('../sendLarkNotify.js', () => ({
  sendApprovalResultNotification: vi.fn(),
  sendLarkCardViaApi: vi.fn(),
  sendLarkMessageViaApi: vi.fn(),
}))

vi.mock('../buildLarkCard.js', () => ({
  buildWelcomeCard: vi.fn().mockReturnValue({}),
  buildTaskCompletedCard: vi.fn().mockReturnValue({}),
}))

vi.mock('../handlers/larkCardActions.js', () => ({
  dispatchCardAction: vi.fn().mockResolvedValue(undefined),
}))

// ── helpers ──

function createMockAdapter(): MessengerAdapter {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    sendAndGetId: vi.fn().mockResolvedValue('msg-placeholder'),
    editMessage: vi.fn().mockResolvedValue(undefined),
    replyImage: vi.fn().mockResolvedValue(undefined),
  }
}

function makeLarkClient(overrides: Record<string, unknown> = {}) {
  const mockWriteFile = vi.fn().mockResolvedValue(undefined)
  return {
    im: {
      v1: {
        messageResource: {
          get: vi.fn().mockResolvedValue({ writeFile: mockWriteFile }),
        },
        message: {
          get: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  msg_type: 'text',
                  body: { content: JSON.stringify({ text: '引用的消息内容' }) },
                },
              ],
            },
          }),
        },
      },
    },
    _mockWriteFile: mockWriteFile,
    ...overrides,
  }
}

function makeFileEvent(overrides: {
  chatType?: string
  mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>
  upperMessageId?: string
} = {}): { data: import('../larkEventRouter.js').LarkMessageEvent; messageId: string } {
  const messageId = 'om_file_001'
  return {
    messageId,
    data: {
      message: {
        message_id: messageId,
        message_type: 'file',
        content: JSON.stringify({ file_key: 'file-key-abc', file_name: 'test.txt' }),
        chat_id: 'oc_chat001',
        chat_type: overrides.chatType ?? 'p2p',
        create_time: String(Date.now()),
        mentions: overrides.mentions,
        upper_message_id: overrides.upperMessageId,
      },
    },
  }
}

// ── Top-level import (module cached by vitest, mocks already hoisted) ──

const { downloadLarkFile, processMessageEvent, destroyGroupBuffer } = await import('../larkEventRouter.js')

// ── Tests ──

describe('downloadLarkFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatSync.mockReturnValue({ size: 1024 }) // 1KB — within limit
  })

  it('returns file path on successful download', async () => {
    const larkClient = makeLarkClient()
    const result = await downloadLarkFile(
      larkClient as never,
      'om_msg_001',
      'file-key-001',
      'report.txt'
    )
    expect(result).toMatch(/lark-file-.*report\.txt$/)
    expect(larkClient.im.v1.messageResource.get).toHaveBeenCalledWith({
      path: { message_id: 'om_msg_001', file_key: 'file-key-001' },
      params: { type: 'file' },
    })
    expect(larkClient._mockWriteFile).toHaveBeenCalled()
  })

  it('returns null when file exceeds 50MB limit', async () => {
    const larkClient = makeLarkClient()
    mockStatSync.mockReturnValue({ size: 51 * 1024 * 1024 }) // 51MB
    const result = await downloadLarkFile(
      larkClient as never,
      'om_msg_002',
      'file-key-002',
      'huge.zip'
    )
    expect(result).toBeNull()
  })

  it('returns null when larkClient API throws', async () => {
    const larkClient = makeLarkClient()
    larkClient.im.v1.messageResource.get.mockRejectedValue(new Error('API error'))
    const result = await downloadLarkFile(
      larkClient as never,
      'om_msg_003',
      'file-key-003',
      'doc.pdf'
    )
    expect(result).toBeNull()
  })

  it('returns null when response has no writeFile method', async () => {
    const larkClient = makeLarkClient()
    larkClient.im.v1.messageResource.get.mockResolvedValue({ someOtherField: true })
    const result = await downloadLarkFile(
      larkClient as never,
      'om_msg_004',
      'file-key-004',
      'data.csv'
    )
    expect(result).toBeNull()
  })

  it('sanitizes filename with special characters', async () => {
    const larkClient = makeLarkClient()
    const result = await downloadLarkFile(
      larkClient as never,
      'om_msg_005',
      'file-key-005',
      '报告 (2024).txt'
    )
    expect(result).toBeTruthy()
    // Filename should not contain spaces or Chinese chars
    expect(result).toMatch(/lark-file-\d+-[a-zA-Z0-9._-]+$/)
  })
})

describe('processMessageEvent — file branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatSync.mockReturnValue({ size: 1024 })
  })

  it('downloads file and calls routeMessage with files param (DM)', async () => {
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()
    const { data } = makeFileEvent({ chatType: 'p2p' })

    await processMessageEvent(data, larkClient as never, adapter, 'TestBot', vi.fn())

    expect(larkClient.im.v1.messageResource.get).toHaveBeenCalled()
    expect(mockRouteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'oc_chat001',
        files: expect.arrayContaining([expect.stringMatching(/lark-file-/)]),
      })
    )
    expect(adapter.reply).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('下载失败')
    )
  })

  it('replies with error when file download fails', async () => {
    const larkClient = makeLarkClient()
    larkClient.im.v1.messageResource.get.mockResolvedValue({ noWriteFile: true })
    const adapter = createMockAdapter()
    const { data } = makeFileEvent({ chatType: 'p2p' })

    await processMessageEvent(data, larkClient as never, adapter, null, vi.fn())

    expect(adapter.reply).toHaveBeenCalledWith(
      'oc_chat001',
      expect.stringContaining('文件下载失败')
    )
    expect(mockRouteMessage).not.toHaveBeenCalled()
  })

  it('skips group file message without @mention', async () => {
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()
    const { data } = makeFileEvent({ chatType: 'group', mentions: [] })

    await processMessageEvent(data, larkClient as never, adapter, 'TestBot', vi.fn())

    expect(larkClient.im.v1.messageResource.get).not.toHaveBeenCalled()
    expect(mockRouteMessage).not.toHaveBeenCalled()
  })

  it('processes group file message when @mention is present', async () => {
    vi.useFakeTimers()
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()
    const { data } = makeFileEvent({
      chatType: 'group',
      mentions: [{ key: 'bot', id: { open_id: 'ou_bot' }, name: 'TestBot' }],
    })

    await processMessageEvent(data, larkClient as never, adapter, 'TestBot', vi.fn())

    expect(larkClient.im.v1.messageResource.get).toHaveBeenCalled()
    // Flush the group buffer timer
    await vi.runAllTimersAsync()

    expect(mockRouteMessage).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('processMessageEvent — quoted message (upper_message_id)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatSync.mockReturnValue({ size: 1024 })
  })

  it('prepends quoted text to message when upper_message_id is present', async () => {
    const larkClient = makeLarkClient()
    // Mock quoted message fetch to return a text
    larkClient.im.v1.message.get.mockResolvedValue({
      data: {
        items: [
          {
            msg_type: 'text',
            body: { content: JSON.stringify({ text: '引用的原始消息' }) },
          },
        ],
      },
    })
    const adapter = createMockAdapter()

    const event: import('../larkEventRouter.js').LarkMessageEvent = {
      message: {
        message_id: 'om_text_001',
        message_type: 'text',
        content: JSON.stringify({ text: '用户的回复' }),
        chat_id: 'oc_chat002',
        chat_type: 'p2p',
        create_time: String(Date.now()),
        upper_message_id: 'om_quoted_001',
      },
    }

    await processMessageEvent(event, larkClient as never, adapter, null, vi.fn())

    expect(larkClient.im.v1.message.get).toHaveBeenCalledWith({
      path: { message_id: 'om_quoted_001' },
    })
    expect(mockRouteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('[引用: 引用的原始消息]'),
      })
    )
    expect(mockRouteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('用户的回复'),
      })
    )
  })

  it('continues processing when quoted message fetch fails', async () => {
    const larkClient = makeLarkClient()
    larkClient.im.v1.message.get.mockRejectedValue(new Error('not found'))
    const adapter = createMockAdapter()

    const event: import('../larkEventRouter.js').LarkMessageEvent = {
      message: {
        message_id: 'om_text_002',
        message_type: 'text',
        content: JSON.stringify({ text: '正常消息' }),
        chat_id: 'oc_chat003',
        chat_type: 'p2p',
        create_time: String(Date.now()),
        upper_message_id: 'om_quoted_002',
      },
    }

    await processMessageEvent(event, larkClient as never, adapter, null, vi.fn())

    // Should still route the message, just without quoted context
    expect(mockRouteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '正常消息',
      })
    )
  })

  it('passes file with quoted context when file message has upper_message_id', async () => {
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()
    const { data } = makeFileEvent({ chatType: 'p2p', upperMessageId: 'om_quoted_003' })

    await processMessageEvent(data, larkClient as never, adapter, null, vi.fn())

    // File download should happen
    expect(larkClient.im.v1.messageResource.get).toHaveBeenCalled()
    // Quoted message should also be fetched
    expect(larkClient.im.v1.message.get).toHaveBeenCalledWith({
      path: { message_id: 'om_quoted_003' },
    })
    // routeMessage should be called with quoted text prepended
    expect(mockRouteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('[引用: 引用的消息内容]'),
        files: expect.arrayContaining([expect.stringMatching(/lark-file-/)]),
      })
    )
  })
})

describe('processMessageEvent — audio message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replies with unsupported notice and returns for audio messages', async () => {
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    const event: import('../larkEventRouter.js').LarkMessageEvent = {
      message: {
        message_id: 'om_audio_001',
        message_type: 'audio',
        content: JSON.stringify({}),
        chat_id: 'oc_chat004',
        chat_type: 'p2p',
        create_time: String(Date.now()),
      },
    }

    await processMessageEvent(event, larkClient as never, adapter, null, vi.fn())

    expect(adapter.reply).toHaveBeenCalledWith(
      'oc_chat004',
      expect.stringContaining('暂不支持音频消息')
    )
    expect(mockRouteMessage).not.toHaveBeenCalled()
  })

  it('does not download or route audio message', async () => {
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    const event: import('../larkEventRouter.js').LarkMessageEvent = {
      message: {
        message_id: 'om_audio_002',
        message_type: 'audio',
        content: '{}',
        chat_id: 'oc_chat005',
        chat_type: 'p2p',
        create_time: String(Date.now()),
      },
    }

    await processMessageEvent(event, larkClient as never, adapter, null, vi.fn())

    expect(larkClient.im.v1.messageResource.get).not.toHaveBeenCalled()
    expect(larkClient.im.v1.message.get).not.toHaveBeenCalled()
  })
})

// ── Group buffer aggregation tests ──

function makeGroupTextEvent(
  text: string,
  chatId = 'oc_group001',
  senderOpenId = 'ou_sender001',
  messageId?: string
): import('../larkEventRouter.js').LarkMessageEvent {
  return {
    sender: { sender_id: { open_id: senderOpenId } },
    message: {
      message_id: messageId ?? `om_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      message_type: 'text',
      content: JSON.stringify({ text }),
      chat_id: chatId,
      chat_type: 'group',
      create_time: String(Date.now()),
      mentions: [{ key: 'bot', id: { open_id: 'ou_bot' }, name: 'TestBot' }],
    },
  }
}

describe('group buffer aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatSync.mockReturnValue({ size: 1024 })
  })

  it('single message passes through without formatting', async () => {
    vi.useFakeTimers()
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    await processMessageEvent(
      makeGroupTextEvent('hello'),
      larkClient as never, adapter, 'TestBot', vi.fn()
    )

    // Not flushed yet
    expect(mockRouteMessage).not.toHaveBeenCalled()

    // Flush timer
    await vi.runAllTimersAsync()

    // Single message: text passed as-is, no context header
    expect(mockRouteMessage).toHaveBeenCalledTimes(1)
    const call = mockRouteMessage.mock.calls[0]![0]!
    expect(call.text).toBe('hello')
    expect(call.text).not.toContain('群聊上下文')

    vi.useRealTimers()
  })

  it('multiple messages aggregate with context format', async () => {
    vi.useFakeTimers()
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    // Send 2 messages from different senders
    await processMessageEvent(
      makeGroupTextEvent('第一条', 'oc_group001', 'ou_aaa1'),
      larkClient as never, adapter, 'TestBot', vi.fn()
    )
    await processMessageEvent(
      makeGroupTextEvent('第二条', 'oc_group001', 'ou_bbb2'),
      larkClient as never, adapter, 'TestBot', vi.fn()
    )

    await vi.runAllTimersAsync()

    expect(mockRouteMessage).toHaveBeenCalledTimes(1)
    const text = (mockRouteMessage.mock.calls[0]![0]! as { text: string }).text
    expect(text).toContain('群聊上下文')
    expect(text).toContain('最近2条@消息')
    expect(text).toContain('第一条')
    expect(text).toContain('最新消息')
    expect(text).toContain('第二条')

    vi.useRealTimers()
  })

  it('flushes immediately when maxMessages (5) reached', async () => {
    vi.useFakeTimers()
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    // Send 5 messages to hit the limit
    for (let i = 0; i < 5; i++) {
      await processMessageEvent(
        makeGroupTextEvent(`msg${i}`, 'oc_group001', `ou_sender${i}`),
        larkClient as never, adapter, 'TestBot', vi.fn()
      )
    }

    // Should flush immediately without needing timer advance
    // But flushGroupBuffer is async, so we need to let microtasks run
    await vi.advanceTimersByTimeAsync(0)

    expect(mockRouteMessage).toHaveBeenCalledTimes(1)
    const text = (mockRouteMessage.mock.calls[0]![0]! as { text: string }).text
    expect(text).toContain('最近5条@消息')

    vi.useRealTimers()
  })

  it('destroyGroupBuffer flushes pending messages', async () => {
    vi.useFakeTimers()
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    await processMessageEvent(
      makeGroupTextEvent('pending msg', 'oc_group001'),
      larkClient as never, adapter, 'TestBot', vi.fn()
    )

    expect(mockRouteMessage).not.toHaveBeenCalled()

    // Destroy should flush without waiting for timer
    await destroyGroupBuffer()

    expect(mockRouteMessage).toHaveBeenCalledTimes(1)
    expect((mockRouteMessage.mock.calls[0]![0]! as { text: string }).text).toBe('pending msg')

    vi.useRealTimers()
  })

  it('different chat IDs get independent buffers', async () => {
    vi.useFakeTimers()
    const larkClient = makeLarkClient()
    const adapter = createMockAdapter()

    await processMessageEvent(
      makeGroupTextEvent('chat1 msg', 'oc_chat_a'),
      larkClient as never, adapter, 'TestBot', vi.fn()
    )
    await processMessageEvent(
      makeGroupTextEvent('chat2 msg', 'oc_chat_b'),
      larkClient as never, adapter, 'TestBot', vi.fn()
    )

    await vi.runAllTimersAsync()

    // Each chat flushed independently
    expect(mockRouteMessage).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})

// Note: chatHandler buildFullPrompt file injection is a module-private function.
// Covered via typecheck in the implement node; skipped here to avoid mock scope conflicts.
