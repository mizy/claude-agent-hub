/**
 * @entry CLI chat command — `cah chat "message"`
 *
 * One-shot chat via the unified message router (same path as Lark).
 */

import type { Command } from 'commander'
import { createCliAdapter, CLI_CLIENT_CONTEXT } from '../../messaging/cliAdapter.js'
import { routeMessage } from '../../messaging/handlers/messageRouter.js'
import { setModelOverride, setBackendOverride } from '../../messaging/handlers/sessionManager.js'

const CHAT_ID = 'cli'

export function registerChatCommand(program: Command) {
  program
    .command('chat')
    .description('与 AI 对话（一次性）')
    .argument('<message>', '消息内容')
    .option('-m, --model <model>', '指定模型 (opus/sonnet/haiku)')
    .option('-b, --backend <type>', '指定 backend')
    .action(async (message: string, options: { model?: string; backend?: string }) => {
      if (options.model) {
        setModelOverride(CHAT_ID, options.model)
      }
      if (options.backend) {
        setBackendOverride(CHAT_ID, options.backend)
      }

      const messenger = createCliAdapter()

      await routeMessage({
        chatId: CHAT_ID,
        text: message,
        messenger,
        clientContext: { ...CLI_CLIENT_CONTEXT },
      })
    })
}
