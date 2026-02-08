/**
 * Levenshtein distance tests
 * Tests string distance calculation and closest match finding
 */

import { describe, it, expect } from 'vitest'
import { levenshteinDistance, findClosestMatch } from '../levenshtein.js'

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0)
    expect(levenshteinDistance('', '')).toBe(0)
  })

  it('should return length of other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3)
    expect(levenshteinDistance('xyz', '')).toBe(3)
  })

  it('should calculate single character difference', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1) // substitution
    expect(levenshteinDistance('cat', 'cats')).toBe(1) // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1) // deletion
  })

  it('should calculate multi-character differences', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
    expect(levenshteinDistance('sunday', 'saturday')).toBe(3)
  })

  it('should handle completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3)
  })
})

describe('findClosestMatch', () => {
  const commands = ['task', 'start', 'stop', 'restart', 'status', 'report', 'dashboard', 'agent']

  it('should find exact match with distance 0', () => {
    const result = findClosestMatch('task', commands)
    expect(result).toEqual({ match: 'task', distance: 0 })
  })

  it('should find close match for typo', () => {
    const result = findClosestMatch('taks', commands)
    expect(result?.match).toBe('task')
    expect(result!.distance).toBeLessThanOrEqual(2)
  })

  it('should find match within default max distance', () => {
    const result = findClosestMatch('star', commands)
    expect(result?.match).toBe('start')
    expect(result!.distance).toBeLessThanOrEqual(2)
  })

  it('should return null when no match within max distance', () => {
    const result = findClosestMatch('abcdefghij', commands)
    expect(result).toBeNull()
  })

  it('should be case-insensitive', () => {
    const result = findClosestMatch('TASK', commands)
    expect(result?.match).toBe('task')
    expect(result?.distance).toBe(0)
  })

  it('should respect custom maxDistance', () => {
    const result = findClosestMatch('stat', commands, 3)
    expect(result).not.toBeNull()

    const strict = findClosestMatch('stat', commands, 0)
    expect(strict).toBeNull()
  })

  it('should return null for empty candidates', () => {
    const result = findClosestMatch('test', [])
    expect(result).toBeNull()
  })

  it('should pick closest when multiple candidates are close', () => {
    const result = findClosestMatch('statu', ['status', 'statue'])
    expect(result?.match).toBe('status')
    expect(result?.distance).toBe(1)
  })
})
