/**
 * Result 类型单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  ok,
  err,
  fromPromise,
  type Result,
} from '../src/shared/result.js'

describe('Result 构造函数', () => {
  it('ok 应创建成功结果', () => {
    const result = ok(42)
    expect(result.ok).toBe(true)
    expect(result.value).toBe(42)
  })

  it('ok 应支持不同类型的值', () => {
    expect(ok('hello').value).toBe('hello')
    expect(ok({ a: 1 }).value).toEqual({ a: 1 })
    expect(ok([1, 2, 3]).value).toEqual([1, 2, 3])
    expect(ok(null).value).toBe(null)
    expect(ok(undefined).value).toBe(undefined)
  })

  it('err 应创建失败结果', () => {
    const error = new Error('failed')
    const result = err(error)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(error)
  })

  it('err 应支持自定义错误类型', () => {
    const customError = { code: 404, message: 'Not found' }
    const result = err(customError)
    expect(result.ok).toBe(false)
    expect(result.error).toEqual(customError)
  })
})

describe('fromPromise', () => {
  it('成功的 Promise 应返回成功结果', async () => {
    const result = await fromPromise(Promise.resolve(42))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(42)
  })

  it('失败的 Promise 应返回错误结果', async () => {
    const error = new Error('async fail')
    const result = await fromPromise(Promise.reject(error))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(error)
  })

  it('非 Error 类型的拒绝应包装为 Error', async () => {
    const result = await fromPromise(Promise.reject('string error'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('string error')
    }
  })
})

describe('Result 类型使用模式', () => {
  it('应支持 .ok 属性作为类型守卫', () => {
    const result: Result<number, Error> = ok(42)
    if (result.ok) {
      expect(result.value).toBe(42)
    }

    const errorResult: Result<number, Error> = err(new Error('fail'))
    if (!errorResult.ok) {
      expect(errorResult.error.message).toBe('fail')
    }
  })
})
