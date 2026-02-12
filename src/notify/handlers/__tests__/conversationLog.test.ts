/**
 * conversationLog 测试 — images 字段支持
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// The module reads DATA_DIR from store/paths which uses CAH_DATA_DIR env var
// vitest.config.ts already sets CAH_DATA_DIR to a temp dir

/** Parse the last line from a JSONL file */
function parseLastLine(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, 'utf-8').trim()
  const lines = content.split('\n').filter(Boolean)
  return JSON.parse(lines[lines.length - 1]!)
}

describe('conversationLog', () => {
  let logConversation: typeof import('../conversationLog.js').logConversation
  let dataDir: string

  beforeEach(async () => {
    dataDir = process.env.CAH_DATA_DIR!
    mkdirSync(dataDir, { recursive: true })

    // Fresh import each test
    const mod = await import('../conversationLog.js')
    logConversation = mod.logConversation
  })

  it('should log entry with images field', () => {
    logConversation({
      ts: '2026-02-11T10:00:00.000Z',
      dir: 'in',
      platform: 'lark',
      chatId: 'chat-001',
      text: '[图片消息]',
      images: ['/tmp/lark-img-001.png'],
    })

    const logPath = join(dataDir, 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.images).toEqual(['/tmp/lark-img-001.png'])
    expect(entry.dir).toBe('in')
    expect(entry.text).toBe('[图片消息]')
  })

  it('should log entry without images when not provided', () => {
    logConversation({
      ts: '2026-02-11T10:00:00.000Z',
      dir: 'in',
      platform: 'lark',
      chatId: 'chat-002',
      text: 'hello',
    })

    const logPath = join(dataDir, 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.images).toBeUndefined()
    expect(entry.text).toBe('hello')
  })

  it('should log multiple images', () => {
    logConversation({
      ts: '2026-02-11T10:00:00.000Z',
      dir: 'in',
      platform: 'lark',
      chatId: 'chat-003',
      text: '',
      images: ['/tmp/img-1.png', '/tmp/img-2.png'],
    })

    const logPath = join(dataDir, 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.images).toEqual(['/tmp/img-1.png', '/tmp/img-2.png'])
  })
})
