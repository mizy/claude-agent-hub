/**
 * 结构化错误提示系统测试
 */

import { describe, it, expect } from 'vitest'
import {
  analyzeError,
  formatError,
  taskNotFoundError,
  workflowGenerationError,
  nodeExecutionError,
} from '../errors.js'

describe('analyzeError', () => {
  it('should detect timeout errors', () => {
    const result = analyzeError('Request timed out after 30000ms')
    expect(result.category).toBe('timeout')
    expect(result.code).toBe('ERR_TIMEOUT')
    expect(result.suggestions).toBeDefined()
    expect(result.suggestions!.length).toBeGreaterThan(0)
  })

  it('should detect network errors', () => {
    const result = analyzeError('ECONNREFUSED: Connection refused')
    expect(result.category).toBe('network')
    expect(result.code).toBe('ERR_NETWORK')
  })

  it('should detect rate limit errors', () => {
    const result = analyzeError('Error 429: Rate limit exceeded')
    expect(result.category).toBe('api')
    expect(result.code).toBe('ERR_RATE_LIMIT')
  })

  it('should detect authentication errors', () => {
    const result = analyzeError('401 Unauthorized: Invalid API key')
    expect(result.category).toBe('api')
    expect(result.code).toBe('ERR_AUTH')
  })

  it('should detect file not found errors', () => {
    const result = analyzeError('ENOENT: no such file or directory "/path/to/file"')
    expect(result.category).toBe('resource')
    expect(result.code).toBe('ERR_FILE_NOT_FOUND')
    expect(result.suggestions).toBeDefined()
    expect(result.suggestions!.some(s => s.includes('确认文件存在'))).toBe(true)
  })

  it('should detect permission errors', () => {
    const result = analyzeError('EACCES: permission denied "/etc/passwd"')
    expect(result.category).toBe('permission')
    expect(result.code).toBe('ERR_PERMISSION')
  })

  it('should handle unknown errors', () => {
    const result = analyzeError('Some random error message')
    expect(result.category).toBe('unknown')
    expect(result.code).toBe('ERR_UNKNOWN')
    expect(result.suggestions).toBeDefined()
  })

  it('should accept Error objects', () => {
    const error = new Error('ETIMEDOUT: connection timed out')
    const result = analyzeError(error)
    expect(result.category).toBe('timeout')
    expect(result.context?.stack).toBeDefined()
  })
})

describe('formatError', () => {
  it('should format error with all fields', () => {
    const structured = analyzeError('Request timeout after 5000ms')
    const formatted = formatError(structured)

    expect(formatted).toContain('错误')
    expect(formatted).toContain('超时')
    expect(formatted).toContain('ERR_TIMEOUT')
    expect(formatted).toContain('建议修复')
  })

  it('should format unknown errors', () => {
    const structured = analyzeError('Something went wrong')
    const formatted = formatError(structured)

    expect(formatted).toContain('错误')
    expect(formatted).toContain('未知')
    expect(formatted).toContain('ERR_UNKNOWN')
  })
})

describe('preset error constructors', () => {
  it('should create task not found error', () => {
    const err = taskNotFoundError('task-12345')
    expect(err.category).toBe('resource')
    expect(err.code).toBe('ERR_TASK_NOT_FOUND')
    expect(err.message).toContain('task-12345')
    expect(err.suggestions).toBeDefined()
    expect(err.suggestions!.some(s => s.includes('cah task list'))).toBe(true)
  })

  it('should create workflow generation error', () => {
    const err = workflowGenerationError('Invalid prompt')
    expect(err.category).toBe('execution')
    expect(err.code).toBe('ERR_WORKFLOW_GEN')
    expect(err.message).toContain('Invalid prompt')
  })

  it('should create node execution error', () => {
    const err = nodeExecutionError('build-step', 'npm install failed')
    expect(err.category).toBe('execution')
    expect(err.code).toBe('ERR_NODE_EXEC')
    expect(err.message).toContain('build-step')
    expect(err.message).toContain('npm install failed')
  })
})
