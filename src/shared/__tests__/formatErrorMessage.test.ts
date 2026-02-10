/**
 * formatErrorMessage 测试
 */

import { describe, it, expect } from 'vitest'
import { formatErrorMessage } from '../formatErrorMessage.js'

describe('formatErrorMessage', () => {
  it('should extract message from Error instance', () => {
    expect(formatErrorMessage(new Error('test error'))).toBe('test error')
  })

  it('should extract message from Error subclass', () => {
    class CustomError extends Error {
      constructor() {
        super('custom error')
      }
    }
    expect(formatErrorMessage(new CustomError())).toBe('custom error')
  })

  it('should convert string to string', () => {
    expect(formatErrorMessage('string error')).toBe('string error')
  })

  it('should convert number to string', () => {
    expect(formatErrorMessage(42)).toBe('42')
  })

  it('should convert null to string', () => {
    expect(formatErrorMessage(null)).toBe('null')
  })

  it('should convert undefined to string', () => {
    expect(formatErrorMessage(undefined)).toBe('undefined')
  })

  it('should convert object to string', () => {
    expect(formatErrorMessage({ code: 404 })).toBe('[object Object]')
  })

  it('should handle empty Error message', () => {
    expect(formatErrorMessage(new Error(''))).toBe('')
  })

  it('should handle boolean', () => {
    expect(formatErrorMessage(false)).toBe('false')
  })
})
