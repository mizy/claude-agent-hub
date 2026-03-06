/**
 * CLI MessengerAdapter — outputs to stdout
 *
 * Used by `cah chat` command to interact with the unified message router.
 */

import type { MessengerAdapter } from './handlers/types.js'

let nextId = 1

export function createCliAdapter(): MessengerAdapter {
  return {
    async reply(_chatId, text) {
      process.stdout.write(text + '\n')
    },

    async sendAndGetId(_chatId, text) {
      process.stdout.write(text + '\n')
      return `cli-msg-${nextId++}`
    },

    async editMessage(_chatId, _messageId, _text) {
      // CLI streaming: ignore intermediate edits, final response via reply()
      return true
    },
  }
}

export const CLI_CLIENT_CONTEXT = {
  platform: 'CLI' as const,
  maxMessageLength: 100000,
  supportedFormats: ['markdown'],
}
