import { describe, it, expect } from 'vitest'
import { extractKeywords } from '../TaskClassifier.js'

describe('extractKeywords', () => {
  it('extracts English words and filters stopwords', () => {
    const result = extractKeywords('the typescript compiler is fast')
    expect(result).toContain('typescript')
    expect(result).toContain('compiler')
    expect(result).toContain('fast')
    expect(result).not.toContain('the')
    expect(result).not.toContain('is')
  })

  it('returns empty for stopwords-only input', () => {
    expect(extractKeywords('a the is')).toEqual([])
  })

  it('extracts Chinese 2-grams from consecutive characters', () => {
    const result = extractKeywords('部署配置优化')
    // "部署配置优化" → 2-grams: 部署, 署配, 配置, 置优, 优化
    expect(result).toContain('部署')
    expect(result).toContain('配置')
    expect(result).toContain('优化')
    expect(result.length).toBe(5)
  })

  it('handles single Chinese character (non-stopword)', () => {
    const result = extractKeywords('猫')
    expect(result).toContain('猫')
  })

  it('filters single Chinese stopword characters', () => {
    const result = extractKeywords('的')
    expect(result).toEqual([])
  })

  it('handles mixed Chinese and English', () => {
    const result = extractKeywords('修复 typescript 类型错误')
    expect(result).toContain('typescript')
    expect(result).toContain('类型')
    expect(result).toContain('型错')
    expect(result).toContain('错误')
  })

  it('deduplicates keywords', () => {
    const result = extractKeywords('test test test')
    expect(result.filter(k => k === 'test')).toHaveLength(1)
  })

  it('handles punctuation correctly', () => {
    const result = extractKeywords('hello, world! typescript.')
    expect(result).toContain('hello')
    expect(result).toContain('world')
    expect(result).toContain('typescript')
  })
})
