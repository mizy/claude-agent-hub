/**
 * Chat input parsing — strip mentions, extract backend/model directives, inline files
 */

import { basename, extname } from 'path'
import { readFileSync, statSync as fsStatSync } from 'fs'
import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import { parseInlineModel } from './selectModel.js'
import { parseBackendOverride } from './parseBackendOverride.js'

const logger = createLogger('chat-input-parser')

export const TEXT_EXTS = new Set([
  '.txt', '.md', '.ts', '.js', '.jsx', '.tsx', '.json', '.yaml', '.yml',
  '.csv', '.xml', '.html', '.css', '.py', '.sh', '.log', '.toml', '.ini',
  '.env', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.rb', '.php',
  '.swift', '.kt', '.scala', '.r', '.lua', '.conf', '.cfg', '.properties',
])
export const MAX_INLINE_SIZE = 50 * 1024 // 50KB per file
export const MAX_TOTAL_INLINE = 200 * 1024 // 200KB total across all files

export interface ParsedInput {
  inlineBackend: string | undefined
  inlineModel: string | undefined
  effectiveText: string
}

/** Strip mentions, extract backend/model directives, return clean text */
export async function parseMessageInput(text: string): Promise<ParsedInput> {
  const mentionCleaned = text.replace(/@_\w+/g, '').trim()
  const { backend: inlineBackend, actualText } = await parseBackendOverride(mentionCleaned)
  const { model: inlineModel, actualText: textAfterModel } = parseInlineModel(
    actualText || mentionCleaned
  )
  const effectiveText = textAfterModel || actualText || mentionCleaned
  return { inlineBackend, inlineModel, effectiveText }
}

/** Build file inline section for prompt */
export function buildFileInlineSection(files: string[]): string {
  let totalInlined = 0
  return files
    .map(p => {
      const name = basename(p)
      const ext = extname(p).toLowerCase()
      if (TEXT_EXTS.has(ext) && totalInlined < MAX_TOTAL_INLINE) {
        try {
          const size = fsStatSync(p).size
          if (size <= MAX_INLINE_SIZE && totalInlined + size <= MAX_TOTAL_INLINE) {
            const content = readFileSync(p, 'utf-8')
            totalInlined += size
            const maxBacktickRun = (content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0)
            const fence = '`'.repeat(Math.max(3, maxBacktickRun + 1))
            return `[用户发送了文件 ${name}，内容如下:]\n${fence}\n${content}\n${fence}`
          }
        } catch (e) { logger.debug(`Failed to read file inline, falling back to path: ${getErrorMessage(e)}`) }
      }
      return `[用户发送了文件 ${name}，路径→${p}←]`
    })
    .join('\n')
}
