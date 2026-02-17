/**
 * Tests for messageRouter session/model/backend commands and routing logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all handler dependencies
vi.mock('../chatHandler.js', () => ({
  handleChat: vi.fn(),
  clearChatSession: vi.fn().mockReturnValue(true),
  getChatSessionInfo: vi.fn(),
  toggleBenchmark: vi.fn().mockReturnValue(true),
}))

vi.mock('../approvalHandler.js', () => ({
  parseApprovalCommand: vi.fn().mockReturnValue(null),
  handleApproval: vi.fn(),
}))

vi.mock('../commandHandler.js', () => ({
  handleCommand: vi.fn().mockResolvedValue({ text: 'ok' }),
}))

vi.mock('../sessionManager.js', () => ({
  setModelOverride: vi.fn(),
  getModelOverride: vi.fn(),
  setBackendOverride: vi.fn(),
  getBackendOverride: vi.fn(),
}))

vi.mock('../episodeExtractor.js', () => ({
  triggerEpisodeOnTaskCreation: vi.fn(),
}))

vi.mock('../../../backend/resolveBackend.js', () => ({
  getRegisteredBackends: vi.fn().mockReturnValue(['claude-code', 'iflow', 'codebuddy']),
}))

import { routeMessage, parseCommandText } from '../messageRouter.js'
import { clearChatSession, getChatSessionInfo, toggleBenchmark, handleChat } from '../chatHandler.js'
import { setModelOverride, getModelOverride, setBackendOverride, getBackendOverride } from '../sessionManager.js'
import { handleCommand } from '../commandHandler.js'
import { triggerEpisodeOnTaskCreation } from '../episodeExtractor.js'
import type { MessengerAdapter, ClientContext } from '../types.js'

function createMockMessenger(): MessengerAdapter & { replyCard?: ReturnType<typeof vi.fn> } {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    sendAndGetId: vi.fn().mockResolvedValue('msg-1'),
  }
}

const clientContext: ClientContext = { platform: 'test', maxMessageLength: 4096, supportedFormats: ['plaintext'] }

async function route(text: string, extra?: Partial<Parameters<typeof routeMessage>[0]>) {
  const messenger = createMockMessenger()
  await routeMessage({ chatId: 'c1', text, messenger, clientContext, ...extra })
  return messenger
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseCommandText — extended', () => {
  it('should strip @mentions with unicode names', () => {
    expect(parseCommandText('@机器人 /new')).toEqual({ cmd: '/new', args: '' })
  })

  it('should strip multiple @mentions', () => {
    expect(parseCommandText('@bot1 @bot2 /run hello')).toEqual({ cmd: '/run', args: 'hello' })
  })

  it('should lowercase commands', () => {
    expect(parseCommandText('/Model Opus')).toEqual({ cmd: '/model', args: 'Opus' })
  })

  it('should return null for plain text', () => {
    expect(parseCommandText('just a message')).toBeNull()
  })

  it('should handle command with no args', () => {
    expect(parseCommandText('/benchmark')).toEqual({ cmd: '/benchmark', args: '' })
  })
})

describe('routeMessage — /new', () => {
  it('should clear session and confirm', async () => {
    const m = await route('/new')
    expect(clearChatSession).toHaveBeenCalledWith('c1')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('新对话'))
  })

  it('should show no-session message when nothing to clear', async () => {
    vi.mocked(clearChatSession).mockReturnValueOnce(false)
    const m = await route('/new')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('没有活跃会话'))
  })
})

describe('routeMessage — /chat', () => {
  it('should show session info when active', async () => {
    vi.mocked(getChatSessionInfo).mockReturnValue({
      sessionId: 'sess-123456789012',
      lastActiveAt: Date.now() - 5 * 60 * 1000,
      turnCount: 3,
      estimatedTokens: 1500,
    })
    const m = await route('/chat')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('sess-123456'))
  })

  it('should show no-session message when inactive', async () => {
    vi.mocked(getChatSessionInfo).mockReturnValue(undefined)
    const m = await route('/chat')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('没有活跃会话'))
  })
})

describe('routeMessage — /benchmark', () => {
  it('should toggle benchmark on', async () => {
    vi.mocked(toggleBenchmark).mockReturnValue(true)
    const m = await route('/benchmark')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('已开启'))
  })

  it('should toggle benchmark off', async () => {
    vi.mocked(toggleBenchmark).mockReturnValue(false)
    const m = await route('/benchmark')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('已关闭'))
  })
})

describe('routeMessage — /model', () => {
  it('should show current model when no args', async () => {
    vi.mocked(getModelOverride).mockReturnValue('opus')
    const m = await route('/model')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('opus'))
  })

  it('should show auto when no override set', async () => {
    vi.mocked(getModelOverride).mockReturnValue(undefined)
    const m = await route('/model')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('auto'))
  })

  it('should clear override with /model auto', async () => {
    await route('/model auto')
    expect(setModelOverride).toHaveBeenCalledWith('c1', undefined)
  })

  it('should set valid model', async () => {
    await route('/model opus')
    expect(setModelOverride).toHaveBeenCalledWith('c1', 'opus')
  })

  it('should reject invalid model', async () => {
    const m = await route('/model gpt4')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('用法'))
  })
})

describe('routeMessage — /backend', () => {
  it('should show current backend when no args', async () => {
    vi.mocked(getBackendOverride).mockReturnValue('iflow')
    const m = await route('/backend')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('iflow'))
  })

  it('should clear override with /backend auto', async () => {
    await route('/backend auto')
    expect(setBackendOverride).toHaveBeenCalledWith('c1', undefined)
  })

  it('should set valid backend', async () => {
    await route('/backend iflow')
    expect(setBackendOverride).toHaveBeenCalledWith('c1', 'iflow')
  })

  it('should reject invalid backend', async () => {
    const m = await route('/backend unknown')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('用法'))
  })
})

describe('routeMessage — task commands', () => {
  it('/run should execute command and trigger episode extraction', async () => {
    const m = await route('/run deploy')
    expect(handleCommand).toHaveBeenCalledWith('/run', 'deploy')
    expect(triggerEpisodeOnTaskCreation).toHaveBeenCalledWith('c1')
    expect(m.reply).toHaveBeenCalledWith('c1', 'ok')
  })

  it('/run error should send error message', async () => {
    vi.mocked(handleCommand).mockRejectedValueOnce(new Error('boom'))
    const m = await route('/run fail')
    expect(m.reply).toHaveBeenCalledWith('c1', expect.stringContaining('失败'))
  })

  it('should send lark card when adapter supports it', async () => {
    const card = { header: { title: { tag: 'plain_text' as const, content: 'Test' } }, elements: [] }
    vi.mocked(handleCommand).mockResolvedValueOnce({ text: 'ok', larkCard: card })
    const messenger = createMockMessenger()
    messenger.replyCard = vi.fn().mockResolvedValue(undefined)
    await routeMessage({ chatId: 'c1', text: '/list', messenger, clientContext })
    expect(messenger.replyCard).toHaveBeenCalledWith('c1', card)
  })

  it('/list should not trigger episode extraction', async () => {
    await route('/list')
    expect(triggerEpisodeOnTaskCreation).not.toHaveBeenCalled()
  })
})

describe('routeMessage — free chat', () => {
  it('should route non-command text to handleChat', async () => {
    await route('hello there')
    expect(handleChat).toHaveBeenCalledWith('c1', 'hello there', expect.anything(), expect.objectContaining({ client: clientContext }))
  })

  it('should pass images to handleChat', async () => {
    const messenger = createMockMessenger()
    await routeMessage({ chatId: 'c1', text: '', images: ['/tmp/a.png'], messenger, clientContext })
    expect(handleChat).toHaveBeenCalledWith('c1', '', expect.anything(), expect.objectContaining({ images: ['/tmp/a.png'] }))
  })
})
