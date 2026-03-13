/**
 * Extract atomic facts from text — pure regex + keyword pattern matching, 0 LLM
 *
 * Atomic facts are the smallest verifiable discrete fact units.
 * Extraction rules:
 * - Fund codes: 6 digits (e.g. 001235) → domain='fund'
 * - API paths: /api/... or http(s)://... → domain='code'
 * - Code identifiers: backtick-wrapped identifiers → domain='code'
 * - Command patterns: npm/pnpm/git/cah + ... → domain='code'
 * - Keyword patterns: "持有/使用/偏好" + entity → fact
 */

import { randomBytes } from 'crypto'
import { loadConfig } from '../config/loadConfig.js'
import type { AtomicFact, MemoryTier } from './types.js'

function generateId(): string {
  return `af-${Date.now()}-${randomBytes(3).toString('hex')}`
}

interface ExtractedEntity {
  entity: string
  domain: string
  context: string // the sentence or surrounding text
}

// Fund code: standalone 6-digit number (only valid when sentence has fund-related context)
const FUND_CODE_RE = /\b(\d{6})\b/g
const FUND_CONTEXT_KEYWORDS = ['基金', 'fund', '净值', '持仓', '收益', '赎回', '申购', '定投', '份额', 'NAV']

// API/URL paths
const URL_RE = /https?:\/\/[^\s,)]+/g
const API_PATH_RE = /\/api\/[^\s,)]+/g

// Backtick code identifiers
const BACKTICK_RE = /`([^`]{2,60})`/g

// CLI command patterns
const CLI_RE = /\b((?:npm|pnpm|git|cah|gh|curl|docker)\s+[a-z][\w\-]*(?:\s+[\w\-./]+)*)/g

// Keyword patterns that indicate a fact worth extracting
const FACT_KEYWORDS_ZH = ['持有', '使用', '偏好', '地址', '路径', '安装', '配置', '设置', '选择']
const FACT_KEYWORDS_EN = ['using', 'prefer', 'located at', 'installed', 'configured', 'set to', 'chose']

/** Split text into sentences (rough, handles both zh and en) */
function splitSentences(text: string): string[] {
  return text.split(/[。！？\n;；]|(?<=\.\s)/).filter(s => s.trim().length > 5)
}

/** Extract entities from text with domain classification */
function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const sentences = splitSentences(text)

  for (const sentence of sentences) {
    // URLs first — extract and strip from sentence before fund code matching
    const urls: string[] = []
    for (const match of sentence.matchAll(URL_RE)) {
      urls.push(match[0])
      entities.push({ entity: match[0], domain: 'code', context: sentence.trim() })
    }

    // Fund codes — only when sentence has fund-related context keywords,
    // and match against URL-stripped text to avoid matching digits in URLs
    const sentenceWithoutUrls = urls.reduce((s, url) => s.replace(url, ''), sentence)
    const sentenceLower = sentence.toLowerCase()
    const hasFundContext = FUND_CONTEXT_KEYWORDS.some(kw => sentenceLower.includes(kw.toLowerCase()))
    if (hasFundContext) {
      for (const match of sentenceWithoutUrls.matchAll(FUND_CODE_RE)) {
        const code = match[1]!
        entities.push({ entity: code, domain: 'fund', context: sentence.trim() })
      }
    }

    // API paths
    for (const match of sentence.matchAll(API_PATH_RE)) {
      entities.push({ entity: match[0], domain: 'code', context: sentence.trim() })
    }

    // Backtick identifiers
    for (const match of sentence.matchAll(BACKTICK_RE)) {
      const inner = match[1]!.trim()
      if (inner.length >= 2 && !inner.includes(' ')) {
        entities.push({ entity: inner, domain: 'code', context: sentence.trim() })
      }
    }

    // CLI commands
    for (const match of sentence.matchAll(CLI_RE)) {
      entities.push({ entity: match[1]!, domain: 'code', context: sentence.trim() })
    }
  }

  return entities
}

/** Check if a sentence contains fact-indicating keywords */
function containsFactKeyword(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  for (const kw of FACT_KEYWORDS_ZH) {
    if (sentence.includes(kw)) return true
  }
  for (const kw of FACT_KEYWORDS_EN) {
    if (lower.includes(kw)) return true
  }
  return false
}

/**
 * Extract atomic facts from text using pure regex + keyword pattern matching.
 *
 * @param text - Input text (conversation message, task output, etc.)
 * @param source - Where this text came from
 * @returns Array of extracted AtomicFact objects
 */
export async function extractAtomicFacts(
  text: string,
  source: 'chat' | 'task' | 'manual',
): Promise<AtomicFact[]> {
  if (!text || text.trim().length < 10) return []

  const config = await loadConfig()
  const maxPerConversation = config.memory.atomicFacts.maxPerConversation

  const entities = extractEntities(text)
  const facts: AtomicFact[] = []
  const seen = new Set<string>() // deduplicate by entity

  const now = new Date().toISOString()
  const defaultTier: MemoryTier = 'hot'

  for (const { entity, domain, context } of entities) {
    if (facts.length >= maxPerConversation) break
    if (seen.has(entity.toLowerCase())) continue
    seen.add(entity.toLowerCase())

    // Only extract as fact if context contains a fact-indicating keyword,
    // or if the entity is a URL/API path (always useful to capture)
    const isUrl = entity.startsWith('http') || entity.startsWith('/api/')
    if (!isUrl && !containsFactKeyword(context)) continue

    // Build fact string from context
    const factText = context.length > 200 ? context.slice(0, 197) + '...' : context

    facts.push({
      id: generateId(),
      fact: factText,
      confidence: 0.7,
      domain,
      source,
      createdAt: now,
      accessCount: 0,
      tier: defaultTier,
    })
  }

  return facts
}
