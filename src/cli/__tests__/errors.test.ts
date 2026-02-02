/**
 * 统一错误处理系统测试
 */

import { describe, it, expect } from 'vitest'
import { AppError } from '../../shared/error.js'

describe('AppError.fromError', () => {
  it('should detect timeout errors', () => {
    const result = AppError.fromError('Request timed out after 30000ms')
    expect(result.category).toBe('TIMEOUT')
    expect(result.code).toBe('ERR_TIMEOUT')
    expect(result.suggestion).toBeDefined()
  })

  it('should detect network errors', () => {
    const result = AppError.fromError('ECONNREFUSED: Connection refused')
    expect(result.category).toBe('NETWORK')
    expect(result.code).toBe('ERR_NETWORK')
  })

  it('should detect rate limit errors', () => {
    const result = AppError.fromError('Error 429: Rate limit exceeded')
    expect(result.category).toBe('API')
    expect(result.code).toBe('ERR_RATE_LIMIT')
  })

  it('should detect authentication errors', () => {
    const result = AppError.fromError('401 Unauthorized: Invalid API key')
    expect(result.category).toBe('API')
    expect(result.code).toBe('ERR_AUTH')
  })

  it('should detect file not found errors', () => {
    const result = AppError.fromError('ENOENT: no such file or directory "/path/to/file"')
    expect(result.category).toBe('RESOURCE')
    expect(result.code).toBe('ERR_FILE_NOT_FOUND')
    expect(result.suggestion).toBeDefined()
    expect(result.suggestion!.includes('确认文件存在')).toBe(true)
  })

  it('should detect permission errors', () => {
    const result = AppError.fromError('EACCES: permission denied "/etc/passwd"')
    expect(result.category).toBe('PERMISSION')
    expect(result.code).toBe('ERR_PERMISSION')
  })

  it('should handle unknown errors', () => {
    const result = AppError.fromError('Some random error message')
    expect(result.category).toBe('UNKNOWN')
    expect(result.code).toBe('ERR_UNKNOWN')
    expect(result.suggestion).toBeDefined()
  })

  it('should accept Error objects', () => {
    const error = new Error('ETIMEDOUT: connection timed out')
    const result = AppError.fromError(error)
    expect(result.category).toBe('TIMEOUT')
    expect(result.cause).toBeDefined()
  })
})

describe('AppError.format', () => {
  it('should format error with all fields', () => {
    const appError = AppError.fromError('Request timeout after 5000ms')
    const formatted = appError.format()

    expect(formatted).toContain('错误')
    expect(formatted).toContain('超时')
    expect(formatted).toContain('ERR_TIMEOUT')
    expect(formatted).toContain('建议修复')
  })

  it('should format unknown errors', () => {
    const appError = AppError.fromError('Something went wrong')
    const formatted = appError.format()

    expect(formatted).toContain('错误')
    expect(formatted).toContain('未知')
    expect(formatted).toContain('ERR_UNKNOWN')
  })
})

describe('AppError factory methods', () => {
  it('should create task not found error', () => {
    const err = AppError.taskNotFound('task-12345')
    expect(err.category).toBe('TASK')
    expect(err.code).toBe('TASK_NOT_FOUND')
    expect(err.message).toContain('task-12345')
    expect(err.suggestion).toBeDefined()
    expect(err.suggestion!.includes('cah task list')).toBe(true)
  })

  it('should create workflow generation error', () => {
    const err = AppError.workflowGeneration('Invalid prompt')
    expect(err.category).toBe('WORKFLOW')
    expect(err.code).toBe('ERR_WORKFLOW_GEN')
    expect(err.message).toContain('Invalid prompt')
  })

  it('should create node execution error', () => {
    const err = AppError.nodeExecution('build-step', 'npm install failed')
    expect(err.category).toBe('RUNTIME')
    expect(err.code).toBe('ERR_NODE_EXEC')
    expect(err.message).toContain('build-step')
    expect(err.message).toContain('npm install failed')
  })
})
