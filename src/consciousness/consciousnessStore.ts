/**
 * Consciousness store
 *
 * 跨会话意识流的写入/读取/格式化/清理
 * 复用 conversationLog.ts 的 append + tail-read 模式
 */

import { join } from 'path'
import {
  appendFileSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'fs'
import { DATA_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { ConsciousnessEntry } from './types.js'

const logger = createLogger('consciousness')

const CONSCIOUSNESS_FILE = join(DATA_DIR, 'consciousness.jsonl')
const MAX_ENTRIES = 500
// Trim when file exceeds ~200KB (average ~200 bytes/entry * 1000 entries)
const TRIM_SIZE_THRESHOLD = 200 * 1024

let initialized = false
let appendCounter = 0
const TRIM_CHECK_INTERVAL = 50

function ensureDir(): void {
  if (initialized) return
  mkdirSync(DATA_DIR, { recursive: true })
  initialized = true
}

/** Read the last N lines from a file by seeking from the end. */
function readTailLines(filePath: string, maxLines: number): string[] {
  const CHUNK_SIZE = 8192
  let fd: number
  let fileSize: number
  try {
    fileSize = statSync(filePath).size
    fd = openSync(filePath, 'r')
  } catch {
    return []
  }

  try {
    const lines: string[] = []
    let carryBuf = Buffer.alloc(0)
    let position = fileSize

    while (position > 0 && lines.length < maxLines) {
      const readSize = Math.min(CHUNK_SIZE, position)
      position -= readSize
      const buf = Buffer.alloc(readSize)
      readSync(fd, buf, 0, readSize, position)
      const combined = carryBuf.length > 0 ? Buffer.concat([buf, carryBuf]) : buf
      const chunk = combined.toString('utf-8')
      const parts = chunk.split('\n')
      carryBuf = Buffer.from(parts[0]!, 'utf-8')
      for (let i = parts.length - 1; i >= 1 && lines.length < maxLines; i--) {
        const line = parts[i]!.trim()
        if (line) lines.unshift(line)
      }
    }
    const remaining = carryBuf.toString('utf-8').trim()
    if (remaining && lines.length < maxLines) {
      lines.unshift(remaining)
    }
    return lines
  } finally {
    closeSync(fd)
  }
}

/** Append a consciousness entry to the JSONL file */
export function appendEntry(entry: ConsciousnessEntry): void {
  try {
    ensureDir()
    appendFileSync(CONSCIOUSNESS_FILE, JSON.stringify(entry) + '\n', 'utf-8')
    // Sample check: only stat every N appends to avoid hot-path I/O
    appendCounter++
    if (appendCounter % TRIM_CHECK_INTERVAL === 0) {
      try {
        const size = statSync(CONSCIOUSNESS_FILE).size
        if (size > TRIM_SIZE_THRESHOLD) {
          trimEntries(MAX_ENTRIES)
        }
      } catch {
        // stat failure is non-critical
      }
    }
  } catch (error) {
    logger.warn(`Failed to write consciousness entry: ${getErrorMessage(error)}`)
  }
}

/** Get the most recent N entries */
export function getRecentEntries(n = 10): ConsciousnessEntry[] {
  try {
    const lines = readTailLines(CONSCIOUSNESS_FILE, n)
    const entries: ConsciousnessEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as ConsciousnessEntry)
      } catch {
        // skip malformed
      }
    }
    return entries
  } catch {
    return []
  }
}

/** Format entries for prompt injection */
export function formatForPrompt(entries: ConsciousnessEntry[]): string {
  if (entries.length === 0) return ''

  const lines = entries.map(e => {
    const time = formatRelativeTime(e.ts)
    const typeLabel = TYPE_LABELS[e.type] || e.type

    if (e.type === 'session_end') {
      let line = `- [${time}] ${e.content}`
      if (e.metadata?.emotionalShift && e.metadata.emotionalShift !== 'neutral→neutral') {
        line += `，情绪${e.metadata.emotionalShift}`
      }
      if (e.metadata?.unfinishedThoughts?.length) {
        line += `，未完成：${e.metadata.unfinishedThoughts.join('；')}`
      }
      return line
    }

    return `- [${time}] ${typeLabel}：${e.content}`
  })

  return `[近期意识流]\n${lines.join('\n')}`
}

/** Format timestamp as relative time string */
function formatRelativeTime(isoTs: string): string {
  const diff = Date.now() - new Date(isoTs).getTime()
  if (isNaN(diff)) return isoTs
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

const TYPE_LABELS: Record<string, string> = {
  conversation_summary: '对话',
  task_event: '任务',
  daemon_event: '系统',
  observation: '观察',
  session_end: '会话结束',
}

/** Trim entries to keep only the most recent maxCount.
 *  Uses write-to-tmp + rename for atomic replacement, avoiding multi-process race. */
export function trimEntries(maxCount = MAX_ENTRIES): void {
  try {
    const content = readFileSync(CONSCIOUSNESS_FILE, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length <= maxCount) return

    const trimmed = lines.slice(lines.length - maxCount)
    const tmpFile = CONSCIOUSNESS_FILE + '.tmp'
    writeFileSync(tmpFile, trimmed.join('\n') + '\n', 'utf-8')
    renameSync(tmpFile, CONSCIOUSNESS_FILE)
    logger.debug(`Trimmed consciousness entries: ${lines.length} → ${maxCount}`)
  } catch (error) {
    logger.warn(`Failed to trim consciousness entries: ${getErrorMessage(error)}`)
  }
}
