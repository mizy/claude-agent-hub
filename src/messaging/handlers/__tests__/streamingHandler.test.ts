import { describe, it, expect, vi, beforeEach } from 'vitest'
import { splitMessage, sendFinalResponse, createStreamHandler } from '../streamingHandler.js'
import type { MessengerAdapter } from '../types.js'

function createMockMessenger(): MessengerAdapter {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(true),
    sendAndGetId: vi.fn().mockResolvedValue('msg-1'),
  }
}

describe('splitMessage', () => {
  it('should return single part for short text', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello'])
  })

  it('should split at newline when possible', () => {
    const text = 'line1\nline2\nline3'
    const parts = splitMessage(text, 10)
    expect(parts[0]).toBe('line1')
    expect(parts.length).toBeGreaterThan(1)
  })

  it('should hard-cut when no suitable newline', () => {
    const text = 'a'.repeat(20)
    const parts = splitMessage(text, 10)
    expect(parts[0]).toBe('a'.repeat(10))
    expect(parts[1]).toBe('a'.repeat(10))
  })

  it('should skip newline at split point', () => {
    const text = '12345\n67890'
    const parts = splitMessage(text, 6)
    expect(parts).toEqual(['12345', '67890'])
  })

  it('should use default maxLength of 4096', () => {
    const text = 'x'.repeat(4000)
    expect(splitMessage(text)).toEqual([text])
  })

  it('should handle newline at very beginning (cutAt <= 0)', () => {
    const text = '\n' + 'x'.repeat(20)
    const parts = splitMessage(text, 10)
    // cutAt=0 falls through to hard cut at maxLength
    expect(parts[0]!.length).toBe(10)
  })

  it('should avoid splitting too early (< 30% threshold)', () => {
    // Newline at position 1 out of maxLength 10 = 10%, below 30%
    const text = 'a\n' + 'b'.repeat(18)
    const parts = splitMessage(text, 10)
    // Should hard-cut at 10 instead of splitting at newline position 1
    expect(parts[0]!.length).toBe(10)
  })
})

describe('sendFinalResponse', () => {
  let messenger: MessengerAdapter

  beforeEach(() => {
    messenger = createMockMessenger()
  })

  it('should edit placeholder with single-part response', async () => {
    await sendFinalResponse('c1', 'hello', 4096, 'ph-1', messenger)
    expect(messenger.editMessage).toHaveBeenCalledWith('c1', 'ph-1', 'hello')
    expect(messenger.reply).not.toHaveBeenCalled()
  })

  it('should edit placeholder and reply remaining parts', async () => {
    const text = 'part1\npart2'
    await sendFinalResponse('c1', text, 6, 'ph-1', messenger)
    expect(messenger.editMessage).toHaveBeenCalledWith('c1', 'ph-1', 'part1\n\n*…（接下条）*')
    expect(messenger.reply).toHaveBeenCalledWith('c1', 'part2')
  })

  it('should reply all parts when no placeholder', async () => {
    await sendFinalResponse('c1', 'hello', 4096, null, messenger)
    expect(messenger.editMessage).not.toHaveBeenCalled()
    expect(messenger.reply).toHaveBeenCalledWith('c1', 'hello')
  })

  it('should NOT fallback to reply when placeholder edit fails (user saw streaming)', async () => {
    vi.mocked(messenger.editMessage).mockResolvedValueOnce(false)
    await sendFinalResponse('c1', 'hello', 4096, 'ph-1', messenger)
    // Should silently skip — no reply() to avoid duplicate messages
    expect(messenger.reply).not.toHaveBeenCalled()
  })

  it('should send multiple parts as separate replies', async () => {
    const text = 'a'.repeat(10) + '\n' + 'b'.repeat(10)
    await sendFinalResponse('c1', text, 11, null, messenger)
    expect(messenger.reply).toHaveBeenCalledTimes(2)
  })

  describe('table → card upgrade', () => {
    const tableText = '| col1 | col2 |\n|------|------|\n| a    | b    |'

    function createCardMessenger(deleteResult: boolean, sendCardResult: string | null) {
      return {
        reply: vi.fn().mockResolvedValue(undefined),
        editMessage: vi.fn().mockResolvedValue(true),
        sendAndGetId: vi.fn().mockResolvedValue('msg-1'),
        deleteMessage: vi.fn().mockResolvedValue(deleteResult),
        sendCard: vi.fn().mockResolvedValue(sendCardResult),
      } satisfies MessengerAdapter
    }

    it('should delete placeholder and send card when table detected', async () => {
      const m = createCardMessenger(true, 'card-1')
      await sendFinalResponse('c1', tableText, 4096, 'ph-1', m)
      expect(m.deleteMessage).toHaveBeenCalledWith('c1', 'ph-1')
      expect(m.sendCard).toHaveBeenCalled()
      expect(m.editMessage).not.toHaveBeenCalled()
      expect(m.reply).not.toHaveBeenCalled()
    })

    it('should fallback to edit when sendCard returns null', async () => {
      const m = createCardMessenger(false, null)
      await sendFinalResponse('c1', tableText, 4096, 'ph-1', m)
      // New logic: send card first → card returns null → placeholder still exists → edit path
      expect(m.sendCard).toHaveBeenCalled()
      expect(m.deleteMessage).not.toHaveBeenCalled()
      expect(m.editMessage).toHaveBeenCalledWith('c1', 'ph-1', tableText)
    })

    it('should fallback to edit when sendCard throws', async () => {
      const m = createCardMessenger(true, null)
      m.sendCard = vi.fn().mockRejectedValue(new Error('network error'))
      await sendFinalResponse('c1', tableText, 4096, 'ph-1', m)
      // Card threw → placeholder still exists → edit path (no reply, no delete)
      expect(m.editMessage).toHaveBeenCalledWith('c1', 'ph-1', tableText)
      expect(m.deleteMessage).not.toHaveBeenCalled()
      expect(m.reply).not.toHaveBeenCalled()
    })

    it('should not trigger card upgrade for tables inside code blocks', async () => {
      const codeBlockTable = '```\n| col1 | col2 |\n|------|------|\n| a    | b    |\n```'
      const m = createCardMessenger(true, 'card-1')
      await sendFinalResponse('c1', codeBlockTable, 4096, 'ph-1', m)
      // Should NOT trigger card upgrade
      expect(m.deleteMessage).not.toHaveBeenCalled()
      expect(m.editMessage).toHaveBeenCalledWith('c1', 'ph-1', codeBlockTable)
    })
  })
})

describe('createStreamHandler', () => {
  let messenger: MessengerAdapter
  let bench: { firstChunk: number }
  let placeholderRef: { placeholderId: string | null }

  beforeEach(() => {
    messenger = createMockMessenger()
    bench = { firstChunk: 0 }
    placeholderRef = { placeholderId: 'ph-1' }
  })

  it('should accumulate chunks', () => {
    const { onChunk, getAccumulated } = createStreamHandler('c1', placeholderRef, 4096, messenger, bench)
    onChunk!('hello ')
    onChunk!('world')
    expect(getAccumulated()).toBe('hello world')
  })

  it('should set firstChunk timestamp', () => {
    const { onChunk } = createStreamHandler('c1', placeholderRef, 4096, messenger, bench)
    expect(bench.firstChunk).toBe(0)
    onChunk!('hi')
    expect(bench.firstChunk).toBeGreaterThan(0)
  })

  it('should send first chunk immediately with streaming indicator', async () => {
    const { onChunk } = createStreamHandler('c1', placeholderRef, 4096, messenger, bench)
    onChunk!('thinking...')
    await new Promise(r => setTimeout(r, 10))
    expect(messenger.editMessage).toHaveBeenCalledWith('c1', 'ph-1', 'thinking... ⏳')
  })

  it('should not edit when no placeholder', () => {
    placeholderRef.placeholderId = null
    const { onChunk } = createStreamHandler('c1', placeholderRef, 4096, messenger, bench)
    onChunk!('hi')
    expect(messenger.editMessage).not.toHaveBeenCalled()
  })

  it('should stop sending edits after stop()', async () => {
    const { onChunk, stop, getAccumulated } = createStreamHandler('c1', placeholderRef, 4096, messenger, bench)
    onChunk!('a')
    stop()
    onChunk!('b')
    expect(getAccumulated()).toBe('ab')
    await new Promise(r => setTimeout(r, 10))
    // Only the first chunk edit should have been sent
    expect(messenger.editMessage).toHaveBeenCalledTimes(1)
  })

  it('should handle edit failures gracefully', async () => {
    vi.mocked(messenger.editMessage).mockResolvedValue(false)
    const { onChunk } = createStreamHandler('c1', placeholderRef, 4096, messenger, bench)
    // Should not throw
    onChunk!('hi')
    await new Promise(r => setTimeout(r, 10))
  })
})
