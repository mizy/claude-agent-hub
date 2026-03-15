/**
 * conversationLog 测试 — images, event, cmd 支持
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
  let logConversation: typeof import('../../../store/conversationLog.js').logConversation
  let logConversationEvent: typeof import('../../../store/conversationLog.js').logConversationEvent
  let logCliCommand: typeof import('../../../store/conversationLog.js').logCliCommand
  let buildRedactedCommand: typeof import('../../../store/conversationLog.js').buildRedactedCommand
  let dataDir: string

  beforeEach(async () => {
    dataDir = process.env.CAH_DATA_DIR!
    mkdirSync(dataDir, { recursive: true })

    // Fresh import each test
    const mod = await import('../../../store/conversationLog.js')
    logConversation = mod.logConversation
    logConversationEvent = mod.logConversationEvent
    logCliCommand = mod.logCliCommand
    buildRedactedCommand = mod.buildRedactedCommand
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

    const logPath = join(dataDir, 'logs', 'conversation.jsonl')
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

    const logPath = join(dataDir, 'logs', 'conversation.jsonl')
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

    const logPath = join(dataDir, 'logs', 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.images).toEqual(['/tmp/img-1.png', '/tmp/img-2.png'])
  })

  it('should log conversation event', () => {
    logConversationEvent('新会话开始', 'chatId: abcd1234', 'chat-evt')

    const logPath = join(dataDir, 'logs', 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.dir).toBe('event')
    expect(entry.event).toBe('新会话开始')
    expect(entry.eventDetail).toBe('chatId: abcd1234')
    expect(entry.chatId).toBe('chat-evt')
  })

  it('should log conversation event without details', () => {
    logConversationEvent('后端切换')

    const logPath = join(dataDir, 'logs', 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.dir).toBe('event')
    expect(entry.event).toBe('后端切换')
    expect(entry.text).toBe('后端切换')
    expect(entry.chatId).toBe('')
  })

  it('should log CLI command with prompt saved to separate file', () => {
    const fullPrompt = '[system context]\n\n[memory]\n\nUser question here'
    logCliCommand({
      backend: 'claude-code',
      command: 'claude --model opus --print <prompt:3847 chars>',
      prompt: fullPrompt,
      sessionId: 'sess-123',
      model: 'opus',
      cwd: '/home/user/project',
    })

    const logPath = join(dataDir, 'logs', 'conversation.jsonl')
    const entry = parseLastLine(logPath)

    expect(entry.dir).toBe('cmd')
    expect(entry.text).toBe('')
    expect(entry.promptLength).toBe(fullPrompt.length)
    expect(entry.promptFile).toMatch(/logs\/prompts\/\d{4}-\d{2}-\d{2}\.txt$/)
    expect(entry.command).toBe('claude --model opus --print <prompt:3847 chars>')
    expect(entry.backendType).toBe('claude-code')
    expect(entry.model).toBe('opus')
    expect(entry.sessionId).toBe('sess-123')

    // Verify the prompt file contains the full prompt
    const promptContent = readFileSync(entry.promptFile as string, 'utf-8')
    expect(promptContent).toContain(fullPrompt)
  })

  it('should build redacted command string', () => {
    const prompt = 'Write a function that sorts an array'
    const args = ['--model', 'opus', '--print', prompt]
    const result = buildRedactedCommand('claude', args, prompt)

    expect(result).toBe(`claude --model opus --print <prompt:${prompt.length} chars>`)
  })

  it('should redact systemPrompt in command string', () => {
    const prompt = 'hello'
    const systemPrompt = 'You are an AI assistant with a long system prompt'
    const args = ['--model', 'opus', '--append-system-prompt', systemPrompt, prompt]
    const result = buildRedactedCommand('claude', args, prompt, systemPrompt)

    expect(result).toBe(`claude --model opus --append-system-prompt <system-prompt:${systemPrompt.length} chars> <prompt:${prompt.length} chars>`)
  })
})
