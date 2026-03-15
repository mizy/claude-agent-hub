/**
 * Foresight — pure rule-based prediction from recurring themes
 *
 * Scans activeThoughts + recent 7-day growth journal for repeated topics.
 * If a topic appears >= 3 times, generates a prediction hint.
 */

import { getTopThoughts } from './activeThoughts.js'
import { loadGrowthJournal } from './growthJournal.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:foresight')

const FORESIGHT_BUDGET = 150

// Common Chinese/English stop words to exclude from keyword frequency analysis
const STOP_WORDS = new Set([
  '的', '了', '和', '在', '是', '有', '我', '这', '个', '不', '也', '就', '都', '要', '会', '到', '说', '被', '把', '让',
  // High-frequency tech bigrams that carry no signal
  '进行', '实现', '处理', '功能', '完成', '修复', '添加', '更新', '检查', '优化', '支持', '使用', '代码', '逻辑', '问题',
  'the', 'is', 'at', 'in', 'on', 'to', 'of', 'and', 'for', 'it', 'as', 'be', 'an', 'or', 'if', 'by', 'so', 'no',
  'this', 'that', 'with', 'from', 'but', 'not', 'are', 'was', 'has', 'had', 'have', 'will', 'can',
  'fix', 'add', 'update', 'impl', 'refactor', 'code', 'test', 'run', 'use',
])

/** Extract words from text — CJK uses 2-char bigrams, English uses whitespace split */
function extractWords(text: string): string[] {
  const words: string[] = []
  for (const segment of text.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/)) {
    if (/[\u4e00-\u9fff]/.test(segment)) {
      for (let i = 0; i < segment.length - 1; i++) words.push(segment.slice(i, i + 2))
    } else if (segment.length >= 2) {
      words.push(segment)
    }
  }
  return words
}

/**
 * Generate foresight hints from recurring themes in recent activity.
 * Returns a single-line string (~150 chars) or empty string if no patterns found.
 */
export function generateForesight(): string {
  try {
    // Collect keywords from active thoughts
    const thoughts = getTopThoughts(10)
    const keywords: string[] = []
    for (const t of thoughts) {
      keywords.push(...extractWords(t.thought))
    }

    // Collect keywords from recent 7-day growth journal
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const entries = loadGrowthJournal(since)
    for (const e of entries) {
      keywords.push(...extractWords(e.description))
    }

    if (keywords.length === 0) return ''

    // Count keyword frequency (excluding stop words)
    const freq = new Map<string, number>()
    for (const w of keywords) {
      const key = w.toLowerCase()
      if (STOP_WORDS.has(key)) continue
      freq.set(key, (freq.get(key) ?? 0) + 1)
    }

    // Find themes appearing >= 3 times
    const recurring = [...freq.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)

    if (recurring.length === 0) return ''

    const hints = recurring.map(([word, count]) => `${word}(${count}次)`).join('、')
    const result = `[预感] 近期反复关注：${hints}`
    return result.length > FORESIGHT_BUDGET ? result.slice(0, FORESIGHT_BUDGET - 1) + '…' : result
  } catch (e) {
    logger.debug(`foresight generation failed: ${getErrorMessage(e)}`)
    return ''
  }
}
