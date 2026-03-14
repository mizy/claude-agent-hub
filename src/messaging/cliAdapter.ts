/**
 * CLI MessengerAdapter — outputs to stdout
 *
 * Used by `cah chat` command. Supports three output formats:
 * - text: streaming chunks written directly to stdout
 * - json: silent during processing, final result captured for JSON output
 * - stream-json: each chunk emitted as a JSON line
 */

import type { MessengerAdapter } from './handlers/types.js'

export type CliOutputFormat = 'text' | 'json' | 'stream-json'

let nextId = 1

export interface CliAdapterResult {
  messenger: MessengerAdapter
  /** Get the final captured response (for json mode) */
  getResponse: () => string
}

export function createCliAdapter(format: CliOutputFormat = 'text'): CliAdapterResult {
  let streamedLength = 0
  let capturedResponse = ''

  // Strip streaming overflow indicator appended by streamingHandler
  function stripIndicator(text: string): string {
    return text.replace(/\n\n\.\.\. \(输出中\)$/, '')
  }

  const messenger: MessengerAdapter = {
    async reply(_chatId, text) {
      if (format === 'text') {
        // If we've been streaming, this is an overflow part or error
        if (streamedLength > 0) {
          // Ensure newline after streamed content, then print overflow part
          process.stdout.write('\n' + text + '\n')
        } else {
          process.stdout.write(text + '\n')
        }
      } else if (format === 'stream-json') {
        // Overflow part — emit as delta
        process.stdout.write(JSON.stringify({ type: 'content_block_delta', delta: text }) + '\n')
      }
      // json mode: capture last reply as the response
      capturedResponse = text
    },

    async sendAndGetId(_chatId, _text) {
      // Suppress placeholder messages ("🤔 思考中..." etc.)
      return `cli-msg-${nextId++}`
    },

    async editMessage(_chatId, _messageId, text) {
      const clean = stripIndicator(text)

      if (format === 'text') {
        const delta = clean.slice(streamedLength)
        if (delta) {
          process.stdout.write(delta)
          streamedLength = clean.length
        }
      } else if (format === 'stream-json') {
        const delta = clean.slice(streamedLength)
        if (delta) {
          process.stdout.write(JSON.stringify({ type: 'content_block_delta', delta }) + '\n')
          streamedLength = clean.length
        }
      }
      // json mode: silent, just capture
      capturedResponse = clean
      return true
    },

    async sendFile(_chatId, filePath) {
      if (format === 'text') {
        process.stdout.write(`📎 File: ${filePath}\n`)
      } else if (format === 'stream-json') {
        process.stdout.write(JSON.stringify({ type: 'file', path: filePath }) + '\n')
      }
    },

    async sendImage(_chatId, imagePath) {
      if (format === 'text') {
        process.stdout.write(`🖼️ Image: ${imagePath}\n`)
      } else if (format === 'stream-json') {
        process.stdout.write(JSON.stringify({ type: 'image', path: imagePath }) + '\n')
      }
    },
  }

  return {
    messenger,
    getResponse: () => capturedResponse,
  }
}

/** Convenience: create a streaming MessengerAdapter for REPL use */
export function createStreamingCliAdapter(): MessengerAdapter {
  return createCliAdapter('text').messenger
}

export const CLI_CLIENT_CONTEXT = {
  platform: 'CLI' as const,
  maxMessageLength: 100000,
  supportedFormats: ['markdown'],
}
