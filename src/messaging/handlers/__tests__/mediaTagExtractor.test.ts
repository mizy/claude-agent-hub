import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'

import { extractMediaTags } from '../mediaTagExtractor.js'
import type { MediaTag } from '../mediaTagExtractor.js'
import type { MessengerAdapter } from '../types.js'

// ── extractMediaTags ──

describe('extractMediaTags', () => {
  it('should parse single SEND_FILE tag', () => {
    const result = extractMediaTags('Here is the report [SEND_FILE: /tmp/report.pdf]')
    expect(result.tags).toEqual([{ type: 'file', path: '/tmp/report.pdf' }])
    expect(result.cleanedText).toBe('Here is the report')
  })

  it('should parse single SEND_IMAGE tag', () => {
    const result = extractMediaTags('Screenshot: [SEND_IMAGE: /tmp/screenshot.png]')
    expect(result.tags).toEqual([{ type: 'image', path: '/tmp/screenshot.png' }])
    expect(result.cleanedText).toBe('Screenshot:')
  })

  it('should parse mixed tags with surrounding text', () => {
    const text =
      'Analysis done.\n[SEND_FILE: /tmp/data.csv]\nSee chart:\n[SEND_IMAGE: /tmp/chart.png]\n[SEND_FILE: /tmp/log.txt]\nEnd.'
    const result = extractMediaTags(text)

    expect(result.tags).toHaveLength(3)
    expect(result.tags[0]).toEqual({ type: 'file', path: '/tmp/data.csv' })
    expect(result.tags[1]).toEqual({ type: 'image', path: '/tmp/chart.png' })
    expect(result.tags[2]).toEqual({ type: 'file', path: '/tmp/log.txt' })
    expect(result.cleanedText).not.toContain('[SEND_FILE')
    expect(result.cleanedText).not.toContain('[SEND_IMAGE')
    expect(result.cleanedText).toContain('Analysis done.')
    expect(result.cleanedText).toContain('End.')
  })

  it('should collapse excessive blank lines after tag removal', () => {
    const text = 'Before\n\n[SEND_FILE: /tmp/a.txt]\n\n\nAfter'
    const result = extractMediaTags(text)
    // Should not have more than 2 consecutive newlines
    expect(result.cleanedText).not.toMatch(/\n{3,}/)
    expect(result.cleanedText).toContain('Before')
    expect(result.cleanedText).toContain('After')
  })

  it('should handle paths with spaces', () => {
    const result = extractMediaTags('[SEND_FILE: /tmp/my folder/my file.pdf]')
    expect(result.tags).toEqual([{ type: 'file', path: '/tmp/my folder/my file.pdf' }])
  })

  it('should return empty tags and original text when no tags present', () => {
    const text = 'Just a normal response with no tags.'
    const result = extractMediaTags(text)
    expect(result.tags).toEqual([])
    expect(result.cleanedText).toBe(text)
  })

  it('should ignore malformed tags', () => {
    const text = '[SEND_FILE /tmp/a.txt] [SEND_: /tmp/b.txt] [SEND_VIDEO: /tmp/c.mp4]'
    const result = extractMediaTags(text)
    expect(result.tags).toEqual([])
  })

  it('should trim whitespace in path', () => {
    const result = extractMediaTags('[SEND_FILE:   /tmp/spaced.txt   ]')
    expect(result.tags[0]!.path).toBe('/tmp/spaced.txt')
  })

  it('should handle empty string', () => {
    const result = extractMediaTags('')
    expect(result.tags).toEqual([])
    expect(result.cleanedText).toBe('')
  })

  it('should be case-sensitive for SEND_FILE/SEND_IMAGE keyword', () => {
    const upper = extractMediaTags('[SEND_FILE: /tmp/a.txt]')
    expect(upper.tags).toHaveLength(1)
    // lowercase should NOT match
    const lower = extractMediaTags('[send_file: /tmp/a.txt]')
    expect(lower.tags).toHaveLength(0)
  })
})

// ── processMediaTags ──

describe('processMediaTags', () => {
  let tempDir: string
  let existingFile: string
  let existingImage: string

  beforeEach(() => {
    tempDir = mkdtempSync(join('/tmp', 'cah-media-test-'))
    existingFile = join(tempDir, 'report.pdf')
    existingImage = join(tempDir, 'chart.png')
    writeFileSync(existingFile, 'dummy pdf')
    writeFileSync(existingImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createMockMessenger(overrides?: Partial<MessengerAdapter>): MessengerAdapter {
    return {
      reply: vi.fn().mockResolvedValue(undefined),
      sendAndGetId: vi.fn().mockResolvedValue(null),
      editMessage: vi.fn().mockResolvedValue(true),
      sendFile: vi.fn().mockResolvedValue(undefined),
      sendImage: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  // Dynamic import to allow vi.mock to take effect
  async function loadProcessMediaTags() {
    const mod = await import('../mediaTagExtractor.js')
    return mod.processMediaTags
  }

  it('should call sendFile for file tags', async () => {
    const messenger = createMockMessenger()
    const tags: MediaTag[] = [{ type: 'file', path: existingFile }]
    const processMediaTags = await loadProcessMediaTags()

    await processMediaTags(tags, 'chat-123', messenger)

    expect(messenger.sendFile).toHaveBeenCalledWith('chat-123', existingFile)
  })

  it('should call sendImage for image tags', async () => {
    const messenger = createMockMessenger()
    const tags: MediaTag[] = [{ type: 'image', path: existingImage }]
    const processMediaTags = await loadProcessMediaTags()

    await processMediaTags(tags, 'chat-123', messenger)

    expect(messenger.sendImage).toHaveBeenCalledWith('chat-123', existingImage)
  })

  it('should reject paths outside allowed directories', async () => {
    const messenger = createMockMessenger()
    const tags: MediaTag[] = [{ type: 'file', path: '/etc/passwd' }]
    const processMediaTags = await loadProcessMediaTags()

    await expect(processMediaTags(tags, 'chat-123', messenger)).resolves.toBeUndefined()
    expect(messenger.sendFile).not.toHaveBeenCalled()
  })

  it('should reject paths with traversal attempts', async () => {
    const messenger = createMockMessenger()
    const tags: MediaTag[] = [{ type: 'file', path: '/tmp/../etc/passwd' }]
    const processMediaTags = await loadProcessMediaTags()

    await expect(processMediaTags(tags, 'chat-123', messenger)).resolves.toBeUndefined()
    expect(messenger.sendFile).not.toHaveBeenCalled()
  })

  it('should skip non-existent files without throwing', async () => {
    const messenger = createMockMessenger()
    const tags: MediaTag[] = [{ type: 'file', path: '/tmp/nonexistent-file.pdf' }]
    const processMediaTags = await loadProcessMediaTags()

    await expect(processMediaTags(tags, 'chat-123', messenger)).resolves.toBeUndefined()
    expect(messenger.sendFile).not.toHaveBeenCalled()
  })

  it('should skip when adapter lacks sendFile/sendImage', async () => {
    const messenger = createMockMessenger({ sendFile: undefined, sendImage: undefined })
    const tags: MediaTag[] = [
      { type: 'file', path: existingFile },
      { type: 'image', path: existingImage },
    ]
    const processMediaTags = await loadProcessMediaTags()

    await expect(processMediaTags(tags, 'chat-123', messenger)).resolves.toBeUndefined()
  })

  it('should process multiple tags in order', async () => {
    const messenger = createMockMessenger()
    const tags: MediaTag[] = [
      { type: 'file', path: existingFile },
      { type: 'image', path: existingImage },
    ]
    const processMediaTags = await loadProcessMediaTags()

    await processMediaTags(tags, 'chat-123', messenger)

    expect(messenger.sendFile).toHaveBeenCalledTimes(1)
    expect(messenger.sendImage).toHaveBeenCalledTimes(1)
  })

  it('should not throw when sendFile throws', async () => {
    const messenger = createMockMessenger({
      sendFile: vi.fn().mockRejectedValue(new Error('upload failed')),
    })
    const tags: MediaTag[] = [{ type: 'file', path: existingFile }]
    const processMediaTags = await loadProcessMediaTags()

    await expect(processMediaTags(tags, 'chat-123', messenger)).resolves.toBeUndefined()
  })

  it('should handle empty tags array', async () => {
    const messenger = createMockMessenger()
    const processMediaTags = await loadProcessMediaTags()

    await processMediaTags([], 'chat-123', messenger)

    expect(messenger.sendFile).not.toHaveBeenCalled()
    expect(messenger.sendImage).not.toHaveBeenCalled()
  })
})
