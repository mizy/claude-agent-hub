/**
 * @entry Interactive REPL mode for `cah chat` (no arguments)
 *
 * Provides a readline-based interactive loop with streaming output,
 * session persistence, and slash commands.
 */

import { createInterface, type Interface as ReadlineInterface } from 'readline'
import { routeMessage } from '../../messaging/handlers/messageRouter.js'
import { createCliAdapter, CLI_CLIENT_CONTEXT } from '../../messaging/cliAdapter.js'
import { setModelOverride, setBackendOverride } from '../../messaging/handlers/sessionManager.js'
import { loadConfig } from '../../config/loadConfig.js'
import { clearChatSession, getChatSessionInfo, cancelActiveChat } from '../../messaging/handlers/chatHandler.js'
import { flushChatMemory } from '../../messaging/handlers/chatMemoryExtractor.js'
import { getErrorMessage } from '../../shared/assertError.js'

const REPL_CHAT_ID_PREFIX = 'cli-repl-'
let sessionCounter = 0

const HELP_TEXT = `可用命令:
  /new      开始新会话
  /compact  压缩上下文（保存记忆后清除会话）
  /model    查看/切换模型 (opus/sonnet/haiku/auto)
  /backend  查看/切换后端
  /status   查看会话状态（别名 /s）
  /help     显示此帮助
  /quit     退出

快捷键:
  Ctrl+C    中断当前 AI 回复 / 再按退出
  Ctrl+D    退出
  ↑/↓       导航历史消息
  \\        行尾反斜杠续行（多行输入）

支持 @path/to/file 语法内联文件内容到消息中`

export interface ReplOptions {
  model?: string
  backend?: string
}

export async function startChatRepl(options: ReplOptions): Promise<void> {
  const chatId = `${REPL_CHAT_ID_PREFIX}${Date.now()}-${sessionCounter++}`
  const config = await loadConfig()
  const backendName = options.backend ?? config.defaultBackend ?? 'claude-code'
  const modelName = options.model ?? 'auto'

  if (options.model) setModelOverride(chatId, options.model)
  if (options.backend) setBackendOverride(chatId, options.backend)

  process.stdout.write(`\x1b[36mcah chat\x1b[0m — 交互式 AI 对话\n`)
  process.stdout.write(`后端: \x1b[33m${backendName}\x1b[0m | 模型: \x1b[33m${modelName}\x1b[0m\n`)
  process.stdout.write(`输入 /help 查看命令，Ctrl+C 中断回复，Ctrl+D 退出\n\n`)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[32m> \x1b[0m',
    terminal: true,
    historySize: 100,
  })

  let isProcessing = false
  let abortedByUser = false
  let pendingAbort = false
  let lineBuffer: string[] = []

  rl.on('SIGINT', () => {
    if (isProcessing) {
      cancelActiveChat(chatId)
      abortedByUser = true
      isProcessing = false
      pendingAbort = false
      process.stdout.write('\n\x1b[33m[中断]\x1b[0m\n')
      rl.prompt()
    } else if (pendingAbort) {
      process.stdout.write('\n')
      cleanup(rl, chatId)
      process.exit(0)
    } else {
      pendingAbort = true
      process.stdout.write('\n\x1b[2m(再按 Ctrl+C 退出)\x1b[0m\n')
      rl.prompt()
    }
  })

  rl.on('close', () => {
    process.stdout.write('\n')
    cleanup(rl, chatId)
    process.exit(0)
  })

  rl.prompt()

  for await (const rawLine of rl) {
    pendingAbort = false

    // Multi-line: line ending with \ continues
    if (rawLine.endsWith('\\')) {
      lineBuffer.push(rawLine.slice(0, -1))
      process.stdout.write('\x1b[2m... \x1b[0m')
      continue
    }

    const line = lineBuffer.length > 0
      ? [...lineBuffer, rawLine].join('\n')
      : rawLine
    lineBuffer = []

    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      continue
    }

    // Handle local slash commands (REPL-only)
    if (trimmed.startsWith('/')) {
      const handled = handleReplCommand(trimmed, chatId)
      if (handled === 'quit') {
        cleanup(rl, chatId)
        return
      }
      if (handled) {
        rl.prompt()
        continue
      }
      // Not a REPL command — fall through to router (e.g. /run, /list)
    }

    // Send to AI via message router
    isProcessing = true
    abortedByUser = false
    const startTime = Date.now()
    const { messenger } = createCliAdapter('text')

    try {
      await routeMessage({
        chatId,
        text: trimmed,
        messenger,
        clientContext: { ...CLI_CLIENT_CONTEXT },
      })
    } catch (err) {
      // If user already pressed Ctrl+C, SIGINT handler showed [中断] and prompt
      if (abortedByUser) {
        isProcessing = false
        continue
      }
      const msg = getErrorMessage(err)
      process.stdout.write(`\x1b[31m错误: ${msg}\x1b[0m\n`)
    }

    // Skip output if SIGINT handler already handled it
    if (abortedByUser) {
      isProcessing = false
      continue
    }

    isProcessing = false
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const info = getChatSessionInfo(chatId)
    const tokens = info?.estimatedTokens ?? 0
    const tokenStr = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
    process.stdout.write(`\n\x1b[2m(${elapsed}s · ~${tokenStr} tokens)\x1b[0m\n\n`)
    rl.prompt()
  }
}

function handleReplCommand(input: string, chatId: string): boolean | 'quit' {
  const parts = input.split(/\s+/)
  const cmd = parts[0]!.toLowerCase()
  const args = parts.slice(1).join(' ').trim()

  switch (cmd) {
    case '/quit':
    case '/exit':
    case '/q':
      return 'quit'

    case '/help':
    case '/h':
      process.stdout.write(HELP_TEXT + '\n')
      return true

    case '/new': {
      const cleared = clearChatSession(chatId)
      process.stdout.write(cleared
        ? '\x1b[32m✓\x1b[0m 已开始新会话\n'
        : '当前没有活跃会话\n')
      return true
    }

    case '/compact': {
      const info = getChatSessionInfo(chatId)
      const tokensBefore = info?.estimatedTokens ?? 0
      flushChatMemory(chatId)
      const cleared = clearChatSession(chatId)
      if (cleared) {
        process.stdout.write(
          `\x1b[32m✓\x1b[0m Context 已压缩，释放 ~${tokensBefore.toLocaleString()} tokens\n`
        )
      } else {
        process.stdout.write('当前没有活跃会话\n')
      }
      return true
    }

    case '/model': {
      if (!args) {
        const info = getChatSessionInfo(chatId)
        const current = info?.modelOverride ?? 'auto'
        process.stdout.write(`当前模型: ${current}\n`)
      } else {
        setModelOverride(chatId, args === 'auto' ? undefined : args)
        process.stdout.write(`\x1b[32m✓\x1b[0m 模型已切换为 ${args}\n`)
      }
      return true
    }

    case '/backend': {
      if (!args) {
        const info = getChatSessionInfo(chatId)
        const current = info?.backendOverride ?? 'auto'
        process.stdout.write(`当前后端: ${current}\n`)
      } else {
        setBackendOverride(chatId, args === 'auto' ? undefined : args)
        process.stdout.write(`\x1b[32m✓\x1b[0m 后端已切换为 ${args}\n`)
      }
      return true
    }

    case '/status':
    case '/s': {
      const info = getChatSessionInfo(chatId)
      const backend = info?.backendOverride ?? 'auto'
      const model = info?.modelOverride ?? 'auto'
      const tokens = info?.estimatedTokens ?? 0
      const tokenStr = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
      const turns = info?.turnCount ?? 0
      process.stdout.write(
        `后端: ${backend} | 模型: ${model}\n` +
        `消息轮次: ${turns} | 估算 tokens: ~${tokenStr}\n`
      )
      return true
    }

    default:
      return false
  }
}

function cleanup(rl: ReadlineInterface, chatId: string): void {
  cancelActiveChat(chatId)
  rl.close()
}
