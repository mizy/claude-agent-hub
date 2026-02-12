import { describe, it, expect } from 'vitest'
import { truncateText } from '../truncateText.js'

describe('truncateText', () => {
  it('returns text unchanged when shorter than maxLength', () => {
    expect(truncateText('hello', 10)).toBe('hello')
  })

  it('returns text unchanged when exactly maxLength', () => {
    expect(truncateText('hello', 5)).toBe('hello')
  })

  it('truncates with ellipsis when exceeding maxLength', () => {
    expect(truncateText('hello world', 8)).toBe('hello...')
  })

  it('uses default maxLength of 40', () => {
    const long = 'a'.repeat(50)
    const result = truncateText(long)
    expect(result.length).toBe(40)
    expect(result.endsWith('...')).toBe(true)
  })

  it('supports custom suffix', () => {
    expect(truncateText('hello world', 8, '…')).toBe('hello w…')
  })

  it('handles empty string', () => {
    expect(truncateText('', 10)).toBe('')
  })

  it('handles maxLength equal to suffix length', () => {
    expect(truncateText('hello', 3)).toBe('...')
  })
})
