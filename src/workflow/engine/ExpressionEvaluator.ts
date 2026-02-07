/**
 * Shared expression evaluation engine
 *
 * Used by both ConditionEvaluator (boolean conditions) and
 * executeNewNodes (general expressions for switch/assign/script/foreach).
 */

import { Parser } from 'expr-eval'
import { createLogger } from '../../shared/logger.js'
import type { EvalContext } from '../types.js'

const logger = createLogger('expr-eval')

// Shared Parser instance with safe operator config
const parser = new Parser({
  operators: {
    assignment: false,
    fndef: false,
    logical: true,
    comparison: true,
    concatenate: true,
    conditional: true,
    add: true,
    multiply: true,
  },
})

// Built-in functions
parser.functions.len = (arr: unknown[]) => (Array.isArray(arr) ? arr.length : 0)
parser.functions.has = (obj: Record<string, unknown>, key: string) =>
  obj != null && typeof obj === 'object' && key in obj
parser.functions.get = (obj: Record<string, unknown>, key: string, defaultValue?: unknown) =>
  obj?.[key] ?? defaultValue
parser.functions.str = (val: unknown) => String(val)
parser.functions.num = (val: unknown) => Number(val)
parser.functions.bool = (val: unknown) => Boolean(val)
parser.functions.now = () => Date.now()
parser.functions.floor = Math.floor
parser.functions.ceil = Math.ceil
parser.functions.round = Math.round
parser.functions.min = Math.min
parser.functions.max = Math.max
parser.functions.abs = Math.abs

/**
 * Preprocess expression: normalize JS-style operators to expr-eval syntax
 */
export function preprocessExpression(expr: string): string {
  let processed = expr.trim()

  // JS global method calls → built-in functions
  processed = processed.replace(/Date\.now\(\)/g, 'now()')
  processed = processed.replace(/Math\.floor\(/g, 'floor(')
  processed = processed.replace(/Math\.ceil\(/g, 'ceil(')
  processed = processed.replace(/Math\.round\(/g, 'round(')
  processed = processed.replace(/Math\.min\(/g, 'min(')
  processed = processed.replace(/Math\.max\(/g, 'max(')
  processed = processed.replace(/Math\.abs\(/g, 'abs(')

  // Logical operators
  processed = processed.replace(/&&/g, ' and ')
  processed = processed.replace(/\|\|/g, ' or ')
  processed = processed.replace(/!/g, ' not ')

  return processed
}

/**
 * Build evaluation scope from context
 */
function buildEvalScope(context: EvalContext): Record<string, unknown> {
  const scope: Record<string, unknown> = {
    outputs: context.outputs ?? {},
    variables: context.variables ?? {},
    loopCount: context.loopCount ?? 0,
    nodeStates: context.nodeStates ?? {},
    inputs: context.inputs ?? {},
    true: true,
    false: false,
    null: null,
  }

  if (context.loopContext) {
    scope.index = context.loopContext.index
    scope.item = context.loopContext.item
    scope.total = context.loopContext.total
  }

  return scope
}

/**
 * Evaluate an expression and return the result
 */
export function evaluateExpression(expression: string, context: EvalContext): unknown {
  try {
    const processed = preprocessExpression(expression)
    const expr = parser.parse(processed)
    const scope = buildEvalScope(context)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return expr.evaluate(scope as any)
  } catch (error) {
    logger.error(`Failed to evaluate expression: "${expression}"`, error)
    throw error
  }
}

/**
 * Evaluate an expression as boolean (for conditions)
 */
export function evaluateCondition(expression: string, context: EvalContext): boolean {
  if (!expression || expression.trim() === '') {
    return true // empty expression defaults to true
  }

  try {
    const result = evaluateExpression(expression, context)
    logger.debug(`Evaluated "${expression}" = ${result}`)
    return Boolean(result)
  } catch {
    return false
  }
}

/**
 * Validate expression syntax without evaluating
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
 * Extract variable references from an expression
 */
export function extractVariables(expression: string): string[] {
  const variables: Set<string> = new Set()

  const patterns = [/outputs\.(\w+)/g, /variables\.(\w+)/g, /nodeStates\.(\w+)/g]

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
