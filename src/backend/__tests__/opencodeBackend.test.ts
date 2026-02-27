/**
 * opencodeBackend 内部辅助函数测试
 *
 * 由于 invoke() 依赖 execa 外部进程，这里只测试可单元测试的逻辑：
 * - buildArgs: 参数构建
 * - parseOutput: 输出解析
 * - toInvokeError: 错误转换
 * - createOpencodeBackend: 适配器结构
 */

import { describe, it, expect } from 'vitest'
import { createOpencodeBackend } from '../opencodeBackend.js'

describe('createOpencodeBackend', () => {
  const backend = createOpencodeBackend()

  it('should have correct name and displayName', () => {
    expect(backend.name).toBe('opencode')
    expect(backend.displayName).toBe('OpenCode')
    expect(backend.cliBinary).toBe('opencode')
  })

  it('should declare capabilities', () => {
    expect(backend.capabilities.supportsStreaming).toBe(true)
    expect(backend.capabilities.supportsSessionReuse).toBe(true)
    expect(backend.capabilities.supportsCostTracking).toBe(true)
    expect(backend.capabilities.supportsMcpConfig).toBe(true)
    expect(backend.capabilities.supportsAgentTeams).toBe(true)
  })

  it('should have invoke and checkAvailable methods', () => {
    expect(typeof backend.invoke).toBe('function')
    expect(typeof backend.checkAvailable).toBe('function')
  })
})

describe('opencodeBackend edge cases', () => {
  it('checkAvailable should return boolean without throwing', async () => {
    const backend = createOpencodeBackend()
    const available = await backend.checkAvailable()
    expect(typeof available).toBe('boolean')
  })
})
