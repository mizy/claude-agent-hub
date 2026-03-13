/**
 * Tests for Phase 2: Atomic facts extraction, store CRUD, and retrieval
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { ATOMIC_FACTS_DIR } from '../src/store/paths.js'
import { extractAtomicFacts } from '../src/memory/extractAtomicFacts.js'
import {
  saveAtomicFact,
  getAtomicFact,
  deleteAtomicFact,
  getAllAtomicFacts,
  queryAtomicFacts,
} from '../src/store/AtomicFactStore.js'
import { retrieveAtomicFacts } from '../src/memory/retrieveMemory.js'
import type { AtomicFact } from '../src/memory/types.js'

function makeFact(overrides: Partial<AtomicFact> & { id: string; fact: string }): AtomicFact {
  return {
    confidence: 0.8,
    domain: 'code',
    source: 'manual',
    createdAt: new Date().toISOString(),
    accessCount: 0,
    tier: 'hot',
    ...overrides,
  }
}

/** Clean atomic facts dir for test isolation */
function cleanFactsDir() {
  if (existsSync(ATOMIC_FACTS_DIR)) {
    rmSync(ATOMIC_FACTS_DIR, { recursive: true, force: true })
  }
  mkdirSync(ATOMIC_FACTS_DIR, { recursive: true })
}

describe('extractAtomicFacts', () => {
  it('should extract fund codes from text with fact keywords', async () => {
    const text = '用户持有中银国有企业债A (001235)，收益不错'
    const facts = await extractAtomicFacts(text, 'chat')
    expect(facts.length).toBeGreaterThanOrEqual(1)
    const fundFact = facts.find(f => f.fact.includes('001235'))
    expect(fundFact).toBeDefined()
    expect(fundFact!.domain).toBe('fund')
    expect(fundFact!.tier).toBe('hot')
    expect(fundFact!.confidence).toBe(0.7)
  })

  it('should extract URL entities', async () => {
    const text = '项目使用 https://api.example.com/v2/data 获取数据'
    const facts = await extractAtomicFacts(text, 'chat')
    expect(facts.length).toBeGreaterThanOrEqual(1)
    const urlFact = facts.find(f => f.fact.includes('https://api.example.com'))
    expect(urlFact).toBeDefined()
    expect(urlFact!.domain).toBe('code')
  })

  it('should extract CLI command patterns with keywords', async () => {
    const text = '配置使用 pnpm run build 来构建项目'
    const facts = await extractAtomicFacts(text, 'task')
    expect(facts.length).toBeGreaterThanOrEqual(1)
    const cmdFact = facts.find(f => f.fact.includes('pnpm'))
    expect(cmdFact).toBeDefined()
  })

  it('should extract backtick code identifiers with keywords', async () => {
    const text = '项目使用 `GenericFileStore` 作为存储基础设施'
    const facts = await extractAtomicFacts(text, 'chat')
    expect(facts.length).toBeGreaterThanOrEqual(1)
    const codeFact = facts.find(f => f.fact.includes('GenericFileStore'))
    expect(codeFact).toBeDefined()
    expect(codeFact!.domain).toBe('code')
  })

  it('should respect maxPerConversation limit', async () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      `项目使用 https://api${i}.example.com/data 服务`
    )
    const text = lines.join('\n')
    const facts = await extractAtomicFacts(text, 'chat')
    expect(facts.length).toBeLessThanOrEqual(10)
  })

  it('should not extract from text without fact keywords', async () => {
    const text = '今天天气真好，阳光明媚，心情很不错。'
    const facts = await extractAtomicFacts(text, 'chat')
    expect(facts.length).toBe(0)
  })

  it('should return empty for very short text', async () => {
    const facts = await extractAtomicFacts('hi', 'chat')
    expect(facts.length).toBe(0)
  })
})

describe('AtomicFactStore CRUD', () => {
  beforeEach(() => cleanFactsDir())

  it('should save and retrieve a fact', () => {
    const fact = makeFact({ id: 'af-test-1', fact: '用户持有基金001235' })
    saveAtomicFact(fact)
    const retrieved = getAtomicFact('af-test-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.fact).toBe('用户持有基金001235')
    expect(retrieved!.domain).toBe('code')
  })

  it('should delete a fact', () => {
    const fact = makeFact({ id: 'af-test-2', fact: 'test fact' })
    saveAtomicFact(fact)
    expect(getAtomicFact('af-test-2')).not.toBeNull()
    const deleted = deleteAtomicFact('af-test-2')
    expect(deleted).toBe(true)
    expect(getAtomicFact('af-test-2')).toBeNull()
  })

  it('should list all facts', () => {
    saveAtomicFact(makeFact({ id: 'af-list-1', fact: 'fact one' }))
    saveAtomicFact(makeFact({ id: 'af-list-2', fact: 'fact two' }))
    const all = getAllAtomicFacts()
    expect(all.length).toBe(2)
  })

  it('should query facts by filter object', () => {
    saveAtomicFact(makeFact({ id: 'af-q1', fact: 'fund fact', domain: 'fund' }))
    saveAtomicFact(makeFact({ id: 'af-q2', fact: 'code fact', domain: 'code' }))
    const fundFacts = queryAtomicFacts({ domain: 'fund' })
    expect(fundFacts.length).toBe(1)
    expect(fundFacts[0]!.id).toBe('af-q1')
  })

  it('should query facts by filter function', () => {
    saveAtomicFact(makeFact({ id: 'af-fn1', fact: 'high confidence', confidence: 0.9 }))
    saveAtomicFact(makeFact({ id: 'af-fn2', fact: 'low confidence', confidence: 0.3 }))
    const highConf = queryAtomicFacts(f => f.confidence > 0.5)
    expect(highConf.length).toBe(1)
    expect(highConf[0]!.id).toBe('af-fn1')
  })
})

describe('retrieveAtomicFacts', () => {
  beforeEach(() => cleanFactsDir())

  it('should retrieve matching facts by entity', () => {
    saveAtomicFact(makeFact({
      id: 'af-ret-1',
      fact: '用户持有基金 001235 中银国有企业债',
      domain: 'fund',
    }))
    saveAtomicFact(makeFact({
      id: 'af-ret-2',
      fact: 'API endpoint at https://api.example.com/data',
      domain: 'code',
    }))

    const results = retrieveAtomicFacts('001235 基金')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe('af-ret-1')
  })

  it('should filter out expired facts', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    saveAtomicFact(makeFact({
      id: 'af-expired',
      fact: '过期的事实 GenericFileStore 已废弃',
      domain: 'code',
      validUntil: pastDate,
    }))
    saveAtomicFact(makeFact({
      id: 'af-valid',
      fact: 'GenericFileStore 是核心存储',
      domain: 'code',
    }))

    const results = retrieveAtomicFacts('GenericFileStore')
    expect(results.every(f => f.id !== 'af-expired')).toBe(true)
    expect(results.some(f => f.id === 'af-valid')).toBe(true)
  })

  it('should filter out low confidence facts', () => {
    saveAtomicFact(makeFact({
      id: 'af-lowconf',
      fact: '可能使用 FileStore 但不确定',
      domain: 'code',
      confidence: 0.3,
    }))
    saveAtomicFact(makeFact({
      id: 'af-highconf',
      fact: '确定使用 FileStore 存储数据',
      domain: 'code',
      confidence: 0.8,
    }))

    const results = retrieveAtomicFacts('FileStore')
    expect(results.every(f => f.id !== 'af-lowconf')).toBe(true)
  })

  it('should return top 5 by default', () => {
    for (let i = 0; i < 8; i++) {
      saveAtomicFact(makeFact({
        id: `af-many-${i}`,
        fact: `fact about GenericFileStore variant ${i}`,
        domain: 'code',
      }))
    }
    const results = retrieveAtomicFacts('GenericFileStore')
    expect(results.length).toBeLessThanOrEqual(5)
  })
})
