/**
 * Web MessengerAdapter — outputs to Express SSE Response
 *
 * Used by dashboard chat API to interact with the unified message router.
 */

import type { Response } from 'express'
import type { MessengerAdapter } from './handlers/types.js'

export interface WebAdapter {
  messenger: MessengerAdapter
  /** Get the last full response text (from final editMessage or last reply) */
  getLastResponse: () => string
}

export function createWebAdapter(res: Response): WebAdapter {
  let nextId = 1
  let lastResponse = ''

  const safeSend = (payload: Record<string, unknown>) => {
    try {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      }
    } catch {
      // Connection already closed, ignore
    }
  }

  return {
    messenger: {
      async reply(_chatId, text) {
        lastResponse = text
        safeSend({ content: text })
      },

      async sendAndGetId(_chatId, text) {
        safeSend({ content: text })
        return `web-msg-${nextId++}`
      },

      async editMessage(_chatId, _messageId, text) {
        lastResponse = text
        safeSend({ content: text, replace: true })
      },
    },
    getLastResponse: () => lastResponse,
  }
}

export const WEB_CLIENT_CONTEXT = {
  platform: 'Web' as const,
  maxMessageLength: 100000,
  supportedFormats: ['markdown', 'html'],
}
