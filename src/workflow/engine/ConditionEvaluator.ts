/**
 * 条件表达式求值器
 * 使用 expr-eval 安全求值
 */

import { Parser } from 'expr-eval'
import { createLogger } from '../../shared/logger.js'
import type { EvalContext } from '../types.js'

const logger = createLogger('condition-eval')

// 创建 Parser 实例，禁用危险操作
const parser = new Parser({
  operators: {
    // 禁用赋值和函数调用
    assignment: false,
    fndef: false,
    // 允许的操作符
    logical: true,
    comparison: true,
    concatenate: true,
    conditional: true,
    add: true,
    multiply: true,
  },
})

// 添加安全的内置函数
parser.functions.len = (arr: unknown[]) => Array.isArray(arr) ? arr.length : 0
parser.functions.has = (obj: Record<string, unknown>, key: string) =>
  obj != null && typeof obj === 'object' && key in obj
parser.functions.get = (obj: Record<string, unknown>, key: string, defaultValue?: unknown) =>
  obj?.[key] ?? defaultValue
parser.functions.str = (val: unknown) => String(val)
parser.functions.num = (val: unknown) => Number(val)
parser.functions.bool = (val: unknown) => Boolean(val)

/**
 * 求值条件表达式
 */
export function evaluateCondition(
  expression: string,
  context: EvalContext
): boolean {
  if (!expression || expression.trim() === '') {
    return true  // 空表达式默认为真
  }

  try {
    // 预处理表达式
    // 将 outputs.xxx.yyy 转换为可访问的形式
    const processedExpr = preprocessExpression(expression)

    const expr = parser.parse(processedExpr)

    // 构建求值上下文
    const evalScope: Record<string, unknown> = {
      outputs: context.outputs ?? {},
      variables: context.variables ?? {},
      loopCount: context.loopCount ?? 0,
      nodeStates: context.nodeStates ?? {},
      // 快捷访问
      true: true,
      false: false,
      null: null,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = expr.evaluate(evalScope as any)

    logger.debug(`Evaluated "${expression}" = ${result}`)

    return Boolean(result)
  } catch (error) {
    logger.error(`Failed to evaluate expression: "${expression}"`, error)
    return false
  }
}

/**
 * 预处理表达式
 * 处理一些常见的语法变体
 */
function preprocessExpression(expr: string): string {
  let processed = expr.trim()

  // 将 == 替换为 === 风格（expr-eval 使用 ==）
  // 实际上 expr-eval 的 == 已经是严格比较
  // processed = processed.replace(/===/g, '==')

  // 支持 && 和 ||
  processed = processed.replace(/&&/g, ' and ')
  processed = processed.replace(/\|\|/g, ' or ')

  // 支持 !
  processed = processed.replace(/!/g, ' not ')

  return processed
}

/**
 * 验证表达式语法
 */
export function validateExpression(expression: string): {
  valid: boolean
  error?: string
} {
  if (!expression || expression.trim() === '') {
    return { valid: true }
  }

  try {
    const processed = preprocessExpression(expression)
    parser.parse(processed)
    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 提取表达式中引用的变量
 */
export function extractVariables(expression: string): string[] {
  const variables: Set<string> = new Set()

  // 匹配 outputs.xxx, variables.xxx, nodeStates.xxx
  const patterns = [
    /outputs\.(\w+)/g,
    /variables\.(\w+)/g,
    /nodeStates\.(\w+)/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(expression)) !== null) {
      if (match[1]) {
        variables.add(match[1])
      }
    }
  }

  return Array.from(variables)
}
