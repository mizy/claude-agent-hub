import { describe, it, expect } from 'vitest'
import { toInvokeError } from '../toInvokeError.js'

describe('toInvokeError', () => {
  it('returns timeout error for timedOut flag', () => {
    const result = toInvokeError({ timedOut: true }, 'TestBackend')
    expect(result).toEqual({ type: 'timeout', message: 'TestBackend 执行超时' })
  })

  it('returns cancelled error for isCanceled flag', () => {
    const result = toInvokeError({ isCanceled: true }, 'TestBackend')
    expect(result).toEqual({ type: 'cancelled', message: '执行被取消' })
  })

  it('returns process error with message from Error object', () => {
    const result = toInvokeError(new Error('something broke'), 'TestBackend')
    expect(result).toEqual({ type: 'process', message: 'something broke', exitCode: undefined })
  })

  it('returns process error with exitCode from execa-style error', () => {
    const result = toInvokeError({ message: 'failed', exitCode: 1 }, 'TestBackend')
    expect(result).toEqual({ type: 'process', message: 'failed', exitCode: 1 })
  })

  it('uses shortMessage as fallback', () => {
    const result = toInvokeError({ shortMessage: 'short msg' }, 'TestBackend')
    expect(result).toEqual({ type: 'process', message: 'short msg', exitCode: undefined })
  })

  it('handles string error', () => {
    const result = toInvokeError('raw error', 'TestBackend')
    expect(result).toEqual({ type: 'process', message: 'raw error' })
  })

  it('handles null/undefined error', () => {
    const result = toInvokeError(null, 'TestBackend')
    expect(result).toEqual({ type: 'process', message: 'null' })
  })

  it('prioritizes timedOut over isCanceled', () => {
    const result = toInvokeError({ timedOut: true, isCanceled: true }, 'TestBackend')
    expect(result.type).toBe('timeout')
  })

  it('includes backend name in timeout message', () => {
    expect(toInvokeError({ timedOut: true }, 'Claude Code').message).toBe('Claude Code 执行超时')
    expect(toInvokeError({ timedOut: true }, 'iflow-cli').message).toBe('iflow-cli 执行超时')
  })
})
