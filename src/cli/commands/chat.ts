/**
 * @entry CLI chat command — `cah chat "message"` or `echo "msg" | cah chat`
 *
 * One-shot chat via the unified message router (same path as Lark).
 * Supports direct argument, pipe input, and multiple output formats.
 */

import type { Command } from 'commander'
import { createCliAdapter, CLI_CLIENT_CONTEXT, type CliOutputFormat } from '../../messaging/cliAdapter.js'
import { routeMessage } from '../../messaging/handlers/messageRouter.js'
import { setModelOverride, setBackendOverride } from '../../messaging/handlers/sessionManager.js'
import { getErrorMessage } from '../../shared/assertError.js'

const CHAT_ID = `cli-${Date.now()}-${process.pid}`

/** Read all of stdin when piped (non-TTY) */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()))
    process.stdin.on('error', reject)
  })
}

export function registerChatCommand(program: Command) {
  program
    .command('chat')
    .description('与 AI 对话（无参数进入交互模式）')
    .argument('[message]', '消息内容（省略且 TTY 则进入交互模式，管道则从 stdin 读取）')
    .option('-m, --model <model>', '指定模型 (opus/sonnet/haiku)')
    .option('-b, --backend <type>', '指定 backend')
    .option('-o, --output-format <format>', '输出格式: text/json/stream-json', 'text')
    .action(async (message: string | undefined, options: {
      model?: string
      backend?: string
      outputFormat?: string
    }) => {
      const format = (options.outputFormat ?? 'text') as CliOutputFormat
      const startTime = Date.now()

      // No message + TTY → interactive REPL mode
      if (!message && process.stdin.isTTY) {
        const { startChatRepl } = await import('./chatRepl.js')
        await startChatRepl({ model: options.model, backend: options.backend })
        return
      }

      // Resolve message from argument or stdin pipe
      let text = message
      if (!text && !process.stdin.isTTY) {
        text = await readStdin()
      }
      if (!text) {
        console.error('错误: 请提供消息内容，或通过管道输入')
        process.exit(1)
      }

      // Apply overrides
      if (options.model) setModelOverride(CHAT_ID, options.model)
      if (options.backend) setBackendOverride(CHAT_ID, options.backend)

      const { messenger, getResponse } = createCliAdapter(format)

      try {
        await routeMessage({
          chatId: CHAT_ID,
          text,
          messenger,
          clientContext: { ...CLI_CLIENT_CONTEXT },
        })

        // JSON mode: output structured result after completion
        if (format === 'json') {
          const result = {
            response: getResponse(),
            model: options.model ?? null,
            backend: options.backend ?? null,
            duration: Date.now() - startTime,
          }
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        } else if (format === 'stream-json') {
          // Emit completion marker
          process.stdout.write(JSON.stringify({
            type: 'message_stop',
            duration: Date.now() - startTime,
          }) + '\n')
        } else {
          // text mode: ensure trailing newline after streaming
          const response = getResponse()
          if (response) {
            // Final newline if streaming didn't end with one
            if (!response.endsWith('\n')) {
              process.stdout.write('\n')
            }
          }
        }

        process.exit(0)
      } catch (error) {
        if (format === 'json') {
          const result = {
            error: getErrorMessage(error),
            duration: Date.now() - startTime,
          }
          process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        } else if (format !== 'stream-json') {
          console.error(`错误: ${getErrorMessage(error)}`)
        }
        process.exit(1)
      }
    })
}
