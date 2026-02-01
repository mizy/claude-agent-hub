/**
 * Result 类型单元测试
 */

import { describe, it, expect } from 'vitest'
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  flatMap,
  fromPromise,
  fromThrowable,
  all,
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

describe('类型守卫', () => {
  it('isOk 应正确识别成功结果', () => {
    const success = ok(42)
    const failure = err(new Error('fail'))

    expect(isOk(success)).toBe(true)
    expect(isOk(failure)).toBe(false)
  })

  it('isErr 应正确识别失败结果', () => {
    const success = ok(42)
    const failure = err(new Error('fail'))

    expect(isErr(success)).toBe(false)
    expect(isErr(failure)).toBe(true)
  })

  it('类型守卫应在条件分支中正确收窄类型', () => {
    const result: Result<number, Error> = ok(42)

    if (isOk(result)) {
      // TypeScript 应该知道这是成功结果
      expect(result.value).toBe(42)
    }

    const errorResult: Result<number, Error> = err(new Error('fail'))
    if (isErr(errorResult)) {
      // TypeScript 应该知道这是错误结果
      expect(errorResult.error.message).toBe('fail')
    }
  })
})

describe('unwrap', () => {
  it('成功结果应返回值', () => {
    const result = ok(42)
    expect(unwrap(result)).toBe(42)
  })

  it('失败结果应抛出错误', () => {
    const error = new Error('test error')
    const result = err(error)
    expect(() => unwrap(result)).toThrow(error)
  })

  it('失败结果应抛出原始错误对象', () => {
    const customError = { code: 'E001' }
    const result = err(customError)
    expect(() => unwrap(result)).toThrow()
    try {
      unwrap(result)
    } catch (e) {
      expect(e).toBe(customError)
    }
  })
})

describe('unwrapOr', () => {
  it('成功结果应返回原始值', () => {
    const result = ok(42)
    expect(unwrapOr(result, 0)).toBe(42)
  })

  it('失败结果应返回默认值', () => {
    const result = err(new Error('fail'))
    expect(unwrapOr(result, 0)).toBe(0)
  })

  it('应支持任意默认值类型', () => {
    const result: Result<string, Error> = err(new Error('fail'))
    expect(unwrapOr(result, 'default')).toBe('default')
  })
})

describe('map', () => {
  it('成功结果应转换值', () => {
    const result = ok(42)
    const mapped = map(result, (x) => x * 2)
    expect(unwrap(mapped)).toBe(84)
  })

  it('失败结果应保持不变', () => {
    const error = new Error('fail')
    const result = err(error)
    const mapped = map(result, (x: number) => x * 2)
    expect(isErr(mapped)).toBe(true)
    if (isErr(mapped)) {
      expect(mapped.error).toBe(error)
    }
  })

  it('应支持类型转换', () => {
    const result = ok(42)
    const mapped = map(result, (x) => x.toString())
    expect(unwrap(mapped)).toBe('42')
  })
})

describe('mapErr', () => {
  it('失败结果应转换错误', () => {
    const result = err('original error')
    const mapped = mapErr(result, (e) => new Error(e))
    expect(isErr(mapped)).toBe(true)
    if (isErr(mapped)) {
      expect(mapped.error.message).toBe('original error')
    }
  })

  it('成功结果应保持不变', () => {
    const result = ok(42)
    const mapped = mapErr(result, (e: string) => new Error(e))
    expect(unwrap(mapped)).toBe(42)
  })
})

describe('flatMap', () => {
  it('成功结果应链式调用', () => {
    const result = ok(42)
    const chained = flatMap(result, (x) => ok(x * 2))
    expect(unwrap(chained)).toBe(84)
  })

  it('链式调用中返回错误应传播', () => {
    const result = ok(42)
    const error = new Error('chain failed')
    const chained = flatMap(result, () => err(error))
    expect(isErr(chained)).toBe(true)
    if (isErr(chained)) {
      expect(chained.error).toBe(error)
    }
  })

  it('失败结果应短路', () => {
    const error = new Error('original')
    const result = err(error)
    let called = false
    const chained = flatMap(result, (x: number) => {
      called = true
      return ok(x * 2)
    })
    expect(called).toBe(false)
    expect(isErr(chained)).toBe(true)
  })

  it('应支持多次链式调用', () => {
    const result = ok(10)
    const chained = flatMap(
      flatMap(result, (x) => ok(x + 5)),
      (x) => ok(x * 2)
    )
    expect(unwrap(chained)).toBe(30)
  })
})

describe('fromPromise', () => {
  it('成功的 Promise 应返回成功结果', async () => {
    const result = await fromPromise(Promise.resolve(42))
    expect(isOk(result)).toBe(true)
    expect(unwrap(result)).toBe(42)
  })

  it('失败的 Promise 应返回错误结果', async () => {
    const error = new Error('async fail')
    const result = await fromPromise(Promise.reject(error))
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toBe(error)
    }
  })

  it('非 Error 类型的拒绝应包装为 Error', async () => {
    const result = await fromPromise(Promise.reject('string error'))
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('string error')
    }
  })
})

describe('fromThrowable', () => {
  it('正常执行应返回成功结果', () => {
    const result = fromThrowable(() => 42)
    expect(isOk(result)).toBe(true)
    expect(unwrap(result)).toBe(42)
  })

  it('抛出异常应返回错误结果', () => {
    const error = new Error('thrown')
    const result = fromThrowable(() => {
      throw error
    })
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toBe(error)
    }
  })

  it('非 Error 类型的异常应包装为 Error', () => {
    const result = fromThrowable(() => {
      throw 'string error'
    })
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('string error')
    }
  })

  it('应捕获 JSON.parse 错误', () => {
    const result = fromThrowable(() => JSON.parse('invalid json'))
    expect(isErr(result)).toBe(true)
  })
})

describe('all', () => {
  it('所有成功应返回值数组', () => {
    const results = [ok(1), ok(2), ok(3)]
    const combined = all(results)
    expect(isOk(combined)).toBe(true)
    expect(unwrap(combined)).toEqual([1, 2, 3])
  })

  it('任一失败应返回第一个错误', () => {
    const error1 = new Error('first')
    const error2 = new Error('second')
    const results = [ok(1), err(error1), err(error2)]
    const combined = all(results)
    expect(isErr(combined)).toBe(true)
    if (isErr(combined)) {
      expect(combined.error).toBe(error1)
    }
  })

  it('空数组应返回空数组结果', () => {
    const results: Result<number, Error>[] = []
    const combined = all(results)
    expect(isOk(combined)).toBe(true)
    expect(unwrap(combined)).toEqual([])
  })

  it('单个失败应返回该错误', () => {
    const error = new Error('only')
    const results = [err(error)]
    const combined = all(results)
    expect(isErr(combined)).toBe(true)
    if (isErr(combined)) {
      expect(combined.error).toBe(error)
    }
  })
})
