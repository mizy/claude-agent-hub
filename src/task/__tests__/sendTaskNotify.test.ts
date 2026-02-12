/**
 * sendTaskNotify — readOutputSummary 逻辑测试
 *
 * 通过 mock fs 来测试 readOutputSummary 的解析逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendTaskCompletionNotify, type TaskNotifyInfo } from '../sendTaskNotify.js'
import type { Task } from '../../types/task.js'

// Mock all external dependencies
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

vi.mock('../../config/loadConfig.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ notify: {} }),
}))

vi.mock('../../notify/sendTelegramNotify.js', () => ({
  sendTelegramTextMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../notify/telegramClient.js', () => ({
  getDefaultChatId: vi.fn().mockReturnValue(null),
}))

vi.mock('../../notify/sendLarkNotify.js', () => ({
  sendLarkCardViaApi: vi.fn().mockResolvedValue(undefined),
  sendLarkMessageViaApi: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../notify/larkWsClient.js', () => ({
  getDefaultLarkChatId: vi.fn().mockReturnValue(null),
}))

vi.mock('../../notify/buildLarkCard.js', () => ({
  buildTaskCompletedCard: vi.fn().mockReturnValue({}),
  buildTaskFailedCard: vi.fn().mockReturnValue({}),
}))

vi.mock('../../store/paths.js', () => ({
  getResultFilePath: vi.fn().mockReturnValue('/tmp/test/result.md'),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-1',
    title: 'Test Task',
    prompt: 'do something',
    status: 'completed',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Task
}

function makeInfo(overrides: Partial<TaskNotifyInfo> = {}): TaskNotifyInfo {
  return {
    durationMs: 10000,
    ...overrides,
  }
}

describe('sendTaskCompletionNotify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not throw on success with no configured channels', async () => {
    // No telegram or lark configured
    await expect(sendTaskCompletionNotify(makeTask(), true, makeInfo())).resolves.not.toThrow()
  })

  it('should not throw on failure with no configured channels', async () => {
    await expect(
      sendTaskCompletionNotify(
        makeTask({ status: 'failed' }),
        false,
        makeInfo({ error: 'something broke' })
      )
    ).resolves.not.toThrow()
  })

  it('should handle Telegram notification with configured bot', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        telegram: { botToken: 'test-token', chatId: '12345' },
      },
    } as any)

    const { sendTelegramTextMessage } = await import('../../notify/sendTelegramNotify.js')

    await sendTaskCompletionNotify(makeTask(), true, makeInfo())

    expect(sendTelegramTextMessage).toHaveBeenCalledTimes(1)
    const message = vi.mocked(sendTelegramTextMessage).mock.calls[0]?.[0]
    expect(message).toContain('Test Task')
    expect(message).toContain('完成')
  })

  it('should handle Lark notification with configured chatId', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        lark: { chatId: 'oc_test123' },
      },
    } as any)

    const { sendLarkCardViaApi } = await import('../../notify/sendLarkNotify.js')
    const { getDefaultLarkChatId } = await import('../../notify/larkWsClient.js')
    vi.mocked(getDefaultLarkChatId).mockReturnValue(null)

    await sendTaskCompletionNotify(makeTask(), true, makeInfo())

    expect(sendLarkCardViaApi).toHaveBeenCalledTimes(1)
  })

  it('should include workflow info in notification', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        telegram: { botToken: 'test-token', chatId: '12345' },
      },
    } as any)

    const { sendTelegramTextMessage } = await import('../../notify/sendTelegramNotify.js')

    await sendTaskCompletionNotify(
      makeTask(),
      true,
      makeInfo({
        workflowName: 'My Workflow',
        nodesCompleted: 3,
        totalNodes: 5,
        nodesFailed: 1,
      })
    )

    const message = vi.mocked(sendTelegramTextMessage).mock.calls[0]?.[0]
    expect(message).toContain('My Workflow')
    expect(message).toContain('3/5')
    expect(message).toContain('1 失败')
  })

  it('should include error info for failed tasks', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        telegram: { botToken: 'test-token', chatId: '12345' },
      },
    } as any)

    const { sendTelegramTextMessage } = await import('../../notify/sendTelegramNotify.js')

    await sendTaskCompletionNotify(
      makeTask({ status: 'failed' }),
      false,
      makeInfo({ error: 'Node execution failed' })
    )

    const message = vi.mocked(sendTelegramTextMessage).mock.calls[0]?.[0]
    expect(message).toContain('失败')
    expect(message).toContain('Node execution failed')
  })

  it('should include cost info when available', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        telegram: { botToken: 'test-token', chatId: '12345' },
      },
    } as any)

    const { sendTelegramTextMessage } = await import('../../notify/sendTelegramNotify.js')

    await sendTaskCompletionNotify(makeTask(), true, makeInfo({ totalCostUsd: 0.1234 }))

    const message = vi.mocked(sendTelegramTextMessage).mock.calls[0]?.[0]
    expect(message).toContain('$0.1234')
  })

  it('should gracefully handle Telegram send failure', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        telegram: { botToken: 'test-token', chatId: '12345' },
      },
    } as any)

    const { sendTelegramTextMessage } = await import('../../notify/sendTelegramNotify.js')
    vi.mocked(sendTelegramTextMessage).mockRejectedValue(new Error('network error'))

    // Should not throw despite send failure
    await expect(sendTaskCompletionNotify(makeTask(), true, makeInfo())).resolves.not.toThrow()
  })

  it('should gracefully handle Lark send failure', async () => {
    const { loadConfig } = await import('../../config/loadConfig.js')
    vi.mocked(loadConfig).mockResolvedValue({
      notify: {
        lark: { chatId: 'oc_test' },
      },
    } as any)

    const { sendLarkCardViaApi } = await import('../../notify/sendLarkNotify.js')
    const { getDefaultLarkChatId } = await import('../../notify/larkWsClient.js')
    vi.mocked(getDefaultLarkChatId).mockReturnValue(null)
    vi.mocked(sendLarkCardViaApi).mockRejectedValue(new Error('lark error'))

    await expect(sendTaskCompletionNotify(makeTask(), true, makeInfo())).resolves.not.toThrow()
  })
})
