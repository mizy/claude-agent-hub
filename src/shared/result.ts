/**
 * Result 类型 - 统一处理成功/失败结果
 * 避免 try-catch 污染业务代码，使错误处理显式化
 */

import { ensureError } from './assertError.js'

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

// 构造函数
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

// 将 Promise 包装为 Result
export async function fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await promise
    return ok(value)
  } catch (e) {
    return err(ensureError(e))
  }
}
