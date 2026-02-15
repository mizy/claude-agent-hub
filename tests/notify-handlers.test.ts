/**
 * Notify handlers unit tests
 *
 * Tests for platform-agnostic message routing, command parsing,
 * approval parsing, and shared constants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseCommandText, routeMessage } from '../src/messaging/handlers/messageRouter.js'
import { parseApprovalCommand } from '../src/messaging/handlers/approvalHandler.js'
import {
  STATUS_EMOJI,
  statusEmoji,
  APPROVAL_COMMANDS,
  TASK_COMMANDS,
} from '../src/messaging/handlers/constants.js'
import type { MessengerAdapter, ClientContext } from '../src/messaging/handlers/types.js'

// Mock backend to prevent real AI calls in routeMessage → handleChat path
vi.mock('../src/backend/index.js', () => ({
  invokeBackend: vi.fn(async () => ({
    ok: true,
    value: { response: 'mock reply', sessionId: 'test-session' },
  })),
}))

// Mock conversation log
vi.mock('../src/messaging/handlers/conversationLog.js', () => ({
  logConversation: vi.fn(),
  getRecentConversations: vi.fn(() => []),
}))

// Mock chat prompts
vi.mock('../src/prompts/chatPrompts.js', () => ({
  buildClientPrompt: vi.fn(() => ''),
}))

// ── Helper: create mock adapter ──

function createMockAdapter(): MessengerAdapter & {
  replyCalls: Array<{ chatId: string; text: string }>
  cardCalls: Array<{ chatId: string; card: unknown }>
} {
  const replyCalls: Array<{ chatId: string; text: string }> = []
  const cardCalls: Array<{ chatId: string; card: unknown }> = []

  return {
    replyCalls,
    cardCalls,
    reply: vi.fn(async (chatId: string, text: string) => {
      replyCalls.push({ chatId, text })
    }),
    sendAndGetId: vi.fn(async () => null),
    editMessage: vi.fn(async () => {}),
    replyCard: vi.fn(async (chatId: string, card: unknown) => {
      cardCalls.push({ chatId, card })
    }),
  }
}

const defaultContext: ClientContext = {
  platform: 'test',
  maxMessageLength: 4096,
  supportedFormats: ['plaintext'],
}

// ── parseCommandText ──

describe('parseCommandText', () => {
  it('parses simple slash command without args', () => {
    expect(parseCommandText('/help')).toEqual({ cmd: '/help', args: '' })
  })

  it('parses slash command with args', () => {
    expect(parseCommandText('/run 创建一个任务')).toEqual({
      cmd: '/run',
      args: '创建一个任务',
    })
  })

  it('lowercases the command', () => {
    expect(parseCommandText('/LIST running')).toEqual({
      cmd: '/list',
      args: 'running',
    })
  })

  it('returns null for non-command text', () => {
    expect(parseCommandText('hello world')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCommandText('')).toBeNull()
  })

  it('strips @mentions before parsing', () => {
    expect(parseCommandText('@BotName /help')).toEqual({ cmd: '/help', args: '' })
  })

  it('strips Chinese @mentions', () => {
    expect(parseCommandText('@机器人 /list running')).toEqual({
      cmd: '/list',
      args: 'running',
    })
  })

  it('handles multiple @mentions', () => {
    expect(parseCommandText('@bot1 @bot2 /run test task')).toEqual({
      cmd: '/run',
      args: 'test task',
    })
  })

  it('returns null when only @mention text (no command)', () => {
    expect(parseCommandText('@bot hello')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(parseCommandText('  /help  ')).toEqual({ cmd: '/help', args: '' })
  })

  it('handles args with extra spaces', () => {
    const result = parseCommandText('/run   multi  word  task')
    expect(result).toEqual({ cmd: '/run', args: 'multi  word  task' })
  })
})

// ── parseApprovalCommand ──

describe('parseApprovalCommand', () => {
  describe('slash commands', () => {
    it('parses /approve', () => {
      expect(parseApprovalCommand('/approve')).toEqual({ action: 'approve' })
    })

    it('parses /approve with nodeId', () => {
      expect(parseApprovalCommand('/approve node-123')).toEqual({
        action: 'approve',
        nodeId: 'node-123',
      })
    })

    it('parses /通过', () => {
      expect(parseApprovalCommand('/通过')).toEqual({ action: 'approve' })
    })

    it('parses /批准', () => {
      expect(parseApprovalCommand('/批准')).toEqual({ action: 'approve' })
    })

    it('parses /reject', () => {
      expect(parseApprovalCommand('/reject')).toEqual({ action: 'reject' })
    })

    it('parses /reject with reason', () => {
      expect(parseApprovalCommand('/reject 代码有问题')).toEqual({
        action: 'reject',
        reason: '代码有问题',
      })
    })

    it('parses /拒绝 with reason', () => {
      expect(parseApprovalCommand('/拒绝 需要修改')).toEqual({
        action: 'reject',
        reason: '需要修改',
      })
    })

    it('parses /否决', () => {
      expect(parseApprovalCommand('/否决')).toEqual({ action: 'reject' })
    })
  })

  describe('bare keywords', () => {
    it('parses "通过"', () => {
      expect(parseApprovalCommand('通过')).toEqual({ action: 'approve' })
    })

    it('parses "approve" (case insensitive)', () => {
      expect(parseApprovalCommand('Approve')).toEqual({ action: 'approve' })
    })

    it('parses "ok"', () => {
      expect(parseApprovalCommand('ok')).toEqual({ action: 'approve' })
    })

    it('parses "yes"', () => {
      expect(parseApprovalCommand('YES')).toEqual({ action: 'approve' })
    })

    it('parses "批准"', () => {
      expect(parseApprovalCommand('批准')).toEqual({ action: 'approve' })
    })

    it('parses "通过 node-xxx"', () => {
      expect(parseApprovalCommand('通过 node-abc')).toEqual({
        action: 'approve',
        nodeId: 'node-abc',
      })
    })

    it('parses "拒绝"', () => {
      expect(parseApprovalCommand('拒绝')).toEqual({ action: 'reject' })
    })

    it('parses "reject"', () => {
      expect(parseApprovalCommand('reject')).toEqual({ action: 'reject' })
    })

    it('parses "no"', () => {
      expect(parseApprovalCommand('no')).toEqual({ action: 'reject' })
    })

    it('parses "否"', () => {
      expect(parseApprovalCommand('否')).toEqual({ action: 'reject' })
    })

    it('parses "拒绝 代码有问题"', () => {
      expect(parseApprovalCommand('拒绝 代码有问题')).toEqual({
        action: 'reject',
        reason: '代码有问题',
      })
    })
  })

  describe('@mention cleanup', () => {
    it('strips @mention before parsing', () => {
      expect(parseApprovalCommand('@bot 通过')).toEqual({ action: 'approve' })
    })

    it('strips multiple @mentions', () => {
      expect(parseApprovalCommand('@bot1 @bot2 拒绝 不行')).toEqual({
        action: 'reject',
        reason: '不行',
      })
    })
  })

  describe('non-approval text', () => {
    it('returns null for regular text', () => {
      expect(parseApprovalCommand('hello world')).toBeNull()
    })

    it('returns null for unknown command', () => {
      expect(parseApprovalCommand('/unknown')).toBeNull()
    })

    it('returns null for partial keyword', () => {
      expect(parseApprovalCommand('通过了吗')).toBeNull()
    })
  })
})

// ── statusEmoji / constants ──

describe('constants', () => {
  describe('statusEmoji', () => {
    it('returns emoji for known statuses', () => {
      expect(statusEmoji('completed')).toBe('✅')
      expect(statusEmoji('failed')).toBe('❌')
      expect(statusEmoji('pending')).toBe('⏳')
      expect(statusEmoji('developing')).toBe('🔨')
    })

    it('returns ❓ for unknown status', () => {
      expect(statusEmoji('unknown-status')).toBe('❓')
    })
  })

  describe('STATUS_EMOJI', () => {
    it('has all expected statuses', () => {
      expect(Object.keys(STATUS_EMOJI)).toEqual(
        expect.arrayContaining(['pending', 'planning', 'developing', 'reviewing', 'completed', 'failed', 'cancelled'])
      )
    })
  })

  describe('APPROVAL_COMMANDS', () => {
    it('contains all approval commands', () => {
      expect(APPROVAL_COMMANDS.has('/approve')).toBe(true)
      expect(APPROVAL_COMMANDS.has('/通过')).toBe(true)
      expect(APPROVAL_COMMANDS.has('/批准')).toBe(true)
      expect(APPROVAL_COMMANDS.has('/reject')).toBe(true)
      expect(APPROVAL_COMMANDS.has('/拒绝')).toBe(true)
      expect(APPROVAL_COMMANDS.has('/否决')).toBe(true)
    })

    it('does not contain task commands', () => {
      expect(APPROVAL_COMMANDS.has('/run')).toBe(false)
      expect(APPROVAL_COMMANDS.has('/list')).toBe(false)
    })
  })

  describe('TASK_COMMANDS', () => {
    it('contains all task commands', () => {
      expect(TASK_COMMANDS.has('/run')).toBe(true)
      expect(TASK_COMMANDS.has('/list')).toBe(true)
      expect(TASK_COMMANDS.has('/logs')).toBe(true)
      expect(TASK_COMMANDS.has('/stop')).toBe(true)
      expect(TASK_COMMANDS.has('/resume')).toBe(true)
      expect(TASK_COMMANDS.has('/get')).toBe(true)
      expect(TASK_COMMANDS.has('/help')).toBe(true)
      expect(TASK_COMMANDS.has('/status')).toBe(true)
    })

    it('does not contain approval commands', () => {
      expect(TASK_COMMANDS.has('/approve')).toBe(false)
      expect(TASK_COMMANDS.has('/reject')).toBe(false)
    })
  })
})

// ── routeMessage ──

describe('routeMessage', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    adapter = createMockAdapter()
  })

  it('routes /new to session clear', async () => {
    await routeMessage({
      chatId: 'chat-1',
      text: '/new',
      messenger: adapter,
      clientContext: defaultContext,
    })

    // No active session → "当前没有活跃会话"; with active session → "已开始新对话"
    expect(adapter.reply).toHaveBeenCalledWith('chat-1', expect.stringContaining('没有活跃会话'))
  })

  it('routes /chat to session info (no active session)', async () => {
    await routeMessage({
      chatId: 'chat-no-session',
      text: '/chat',
      messenger: adapter,
      clientContext: defaultContext,
    })

    expect(adapter.reply).toHaveBeenCalledWith(
      'chat-no-session',
      expect.stringContaining('没有活跃会话')
    )
  })

  it('routes /help to command handler', async () => {
    await routeMessage({
      chatId: 'chat-1',
      text: '/help',
      messenger: adapter,
      clientContext: defaultContext,
    })

    // /help returns larkCard, so replyCard should be called (adapter has replyCard)
    const replyCalled = adapter.reply.mock.calls.length > 0
    const cardCalled = (adapter.replyCard as ReturnType<typeof vi.fn>).mock.calls.length > 0
    expect(replyCalled || cardCalled).toBe(true)
  })

  it('routes /status to command handler', async () => {
    await routeMessage({
      chatId: 'chat-1',
      text: '/status',
      messenger: adapter,
      clientContext: defaultContext,
    })

    const replyCalled = adapter.reply.mock.calls.length > 0
    const cardCalled = (adapter.replyCard as ReturnType<typeof vi.fn>).mock.calls.length > 0
    expect(replyCalled || cardCalled).toBe(true)
  })

  it('routes /new with @mention prefix', async () => {
    await routeMessage({
      chatId: 'chat-1',
      text: '@bot /new',
      messenger: adapter,
      clientContext: defaultContext,
    })

    expect(adapter.reply).toHaveBeenCalledWith('chat-1', expect.stringContaining('没有活跃会话'))
  })

  it('does not check bare approval when checkBareApproval=false', async () => {
    // "通过" without slash should go to chat handler when checkBareApproval is false
    // We mock handleChat by spying — but since routeMessage calls handleChat internally,
    // we just verify it doesn't send an approval-like response
    await routeMessage({
      chatId: 'chat-bare',
      text: '通过',
      messenger: adapter,
      clientContext: defaultContext,
      checkBareApproval: false,
    })

    // Should have called something (chat handler sends a message)
    // The key assertion: it should NOT be an approval response
    if (adapter.replyCalls.length > 0) {
      // The chat handler sends '🤔 思考中...' via sendAndGetId, not via reply with approval text
      expect(adapter.replyCalls[0]?.text).not.toContain('已批准')
    }
  })

  it('handles unknown slash command as chat', async () => {
    await routeMessage({
      chatId: 'chat-1',
      text: '/unknowncmd',
      messenger: adapter,
      clientContext: defaultContext,
    })

    // Unknown slash commands not in TASK_COMMANDS or APPROVAL_COMMANDS fall through to chat
    // The chat handler will invoke the backend, so sendAndGetId is called for the placeholder
    expect(adapter.sendAndGetId).toHaveBeenCalled()
  })
})
