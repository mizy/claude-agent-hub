import { describe, it, expect } from 'vitest'
import { formatMemoriesForPrompt } from '../formatMemory.js'
import type { MemoryEntry } from '../types.js'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'test-id',
    content: 'test content',
    category: 'lesson',
    keywords: ['test'],
    source: { type: 'manual' },
    confidence: 0.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  }
}

describe('formatMemoriesForPrompt', () => {
  it('returns empty string for empty array', () => {
    expect(formatMemoriesForPrompt([])).toBe('')
  })

  it('formats single category', () => {
    const memories = [
      makeEntry({ content: 'always run tests', category: 'lesson' }),
      makeEntry({ content: 'check CI before merge', category: 'lesson' }),
    ]

    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('## 记忆上下文')
    expect(result).toContain('### 经验教训')
    expect(result).toContain('- always run tests')
    expect(result).toContain('- check CI before merge')
  })

  it('formats multiple categories in stable order', () => {
    const memories = [
      makeEntry({ content: 'use pnpm', category: 'preference' }),
      makeEntry({ content: 'avoid any type', category: 'pitfall' }),
      makeEntry({ content: 'barrel exports', category: 'pattern' }),
    ]

    const result = formatMemoriesForPrompt(memories)

    // Order: pattern → lesson → pitfall → preference → tool
    const patternIdx = result.indexOf('### 最佳实践')
    const pitfallIdx = result.indexOf('### 注意事项')
    const prefIdx = result.indexOf('### 偏好设置')

    expect(patternIdx).toBeLessThan(pitfallIdx)
    expect(pitfallIdx).toBeLessThan(prefIdx)
  })

  it('omits empty categories', () => {
    const memories = [
      makeEntry({ content: 'only lesson', category: 'lesson' }),
    ]

    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('### 经验教训')
    expect(result).not.toContain('### 最佳实践')
    expect(result).not.toContain('### 注意事项')
    expect(result).not.toContain('### 偏好设置')
    expect(result).not.toContain('### 工具经验')
  })

  it('formats all five categories', () => {
    const memories = [
      makeEntry({ content: 'p1', category: 'pattern' }),
      makeEntry({ content: 'l1', category: 'lesson' }),
      makeEntry({ content: 'pi1', category: 'pitfall' }),
      makeEntry({ content: 'pr1', category: 'preference' }),
      makeEntry({ content: 't1', category: 'tool' }),
    ]

    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('### 最佳实践')
    expect(result).toContain('### 经验教训')
    expect(result).toContain('### 注意事项')
    expect(result).toContain('### 偏好设置')
    expect(result).toContain('### 工具经验')
  })

  it('renders each entry as a bullet point', () => {
    const memories = [
      makeEntry({ content: 'first item', category: 'tool' }),
      makeEntry({ content: 'second item', category: 'tool' }),
    ]

    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('- first item')
    expect(result).toContain('- second item')
  })
})
