/**
 * Shared expression evaluation engine
 *
 * Used by both ConditionEvaluator (boolean conditions) and
 * executeNewNodes (general expressions for switch/assign/script/foreach).
 */

import { Parser } from 'expr-eval'
import { createLogger } from '../../shared/logger.js'
import { formatErrorMessage } from '../../shared/formatErrorMessage.js'
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
// String functions (expr-eval doesn't support method calls like .includes())
parser.functions.includes = (str: unknown, substr: unknown) =>
  typeof str === 'string' && typeof substr === 'string' && str.includes(substr)
parser.functions.startsWith = (str: unknown, prefix: unknown) =>
  typeof str === 'string' && typeof prefix === 'string' && str.startsWith(prefix)
parser.functions.lower = (str: unknown) => (typeof str === 'string' ? str.toLowerCase() : '')
parser.functions.upper = (str: unknown) => (typeof str === 'string' ? str.toUpperCase() : '')

// expr-eval reserved words that cannot be used as property names after dot notation.
// These are built-in math/trig function names that the parser treats as special tokens.
const EXPR_EVAL_RESERVED = new Set([
  'round', 'floor', 'ceil', 'abs',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sqrt', 'log', 'log2', 'log10', 'exp',
  'trunc', 'sign', 'cbrt', 'expm1', 'log1p',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'random', 'fac', 'length', 'pyt',
])

/**
 * Preprocess expression: normalize JS-style operators to expr-eval syntax
 */
export function preprocessExpression(expr: string): string {
  let processed = expr.trim()

  // Escape expr-eval reserved words used as property names (e.g. variables.round → variables.__round)
  // Only matches dot-access pattern (not function calls like round(...))
  processed = processed.replace(
    /\.(\w+)(?!\s*\()/g,
    (_match, prop: string) => EXPR_EVAL_RESERVED.has(prop) ? `.__${prop}` : `.${prop}`,
  )

  // Bracket notation → dot notation with underscore alias
  // e.g. outputs['verify-consistency']._raw → outputs.verify_consistency._raw
  // Works because buildEvalContext creates hyphen→underscore aliases via createHyphenAliases
  processed = processed.replace(
    /(\w+)\['([^']+)'\]/g,
    (_match, obj, key: string) => `${obj}.${key.replace(/-/g, '_')}`,
  )
  processed = processed.replace(
    /(\w+)\["([^"]+)"\]/g,
    (_match, obj, key: string) => `${obj}.${key.replace(/-/g, '_')}`,
  )

  // JS global method calls → built-in functions
  processed = processed.replace(/Date\.now\(\)/g, 'now()')
  processed = processed.replace(/Math\.floor\(/g, 'floor(')
  processed = processed.replace(/Math\.ceil\(/g, 'ceil(')
  processed = processed.replace(/Math\.round\(/g, 'round(')
  processed = processed.replace(/Math\.min\(/g, 'min(')
  processed = processed.replace(/Math\.max\(/g, 'max(')
  processed = processed.replace(/Math\.abs\(/g, 'abs(')

  // Case conversion first (so chained calls like .toLowerCase().includes() work)
  processed = processed.replace(
    /(\w[\w.]*?)\.toLowerCase\(\)/g,
    'lower($1)',
  )
  processed = processed.replace(
    /(\w[\w.]*?)\.toUpperCase\(\)/g,
    'upper($1)',
  )

  // Method calls → function calls: obj.includes('x') → includes(obj, 'x')
  // Also handles function results: lower(x).includes('y') → includes(lower(x), 'y')
  processed = processed.replace(
    /((?:\w+\([^)]*\))|\w[\w.]*?)\.includes\(([^)]+)\)/g,
    'includes($1, $2)',
  )
  processed = processed.replace(
    /((?:\w+\([^)]*\))|\w[\w.]*?)\.startsWith\(([^)]+)\)/g,
    'startsWith($1, $2)',
  )

  // Compat: outputs.X.result → outputs.X._raw (node output stored as _raw, not result)
  processed = processed.replace(/outputs\.(\w+)\.result\b/g, 'outputs.$1._raw')

  // Logical operators
  processed = processed.replace(/&&/g, ' and ')
  processed = processed.replace(/\|\|/g, ' or ')
  // Replace ! but not != and !==
  processed = processed.replace(/!(?!=)/g, ' not ')

  return processed
}

/**
 * Add __reserved aliases for expr-eval reserved word keys in an object.
 * E.g. { round: 0 } → { round: 0, __round: 0 }
 */
function addReservedAliases(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    if (EXPR_EVAL_RESERVED.has(key)) {
      obj[`__${key}`] = obj[key]
    }
  }
  return obj
}

/**
 * Make nested object safe for expr-eval: replace undefined/null leaf values with empty string
 * so that expressions like `outputs.review.result` don't throw on missing fields.
 */
function safeOutputs(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) {
      // At depth 0, wrap with _raw so outputs.node._raw still works
      safe[key] = depth === 0 ? addReservedAliases({ _raw: '' }) : ''
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = safeOutputs(value as Record<string, unknown>, depth + 1)
      // At depth 0, ensure _raw exists even for object outputs (e.g. structured output missing _raw)
      if (depth === 0 && !('_raw' in nested)) {
        nested._raw = ''
      }
      safe[key] = nested
    } else if (Array.isArray(value)) {
      // Arrays are structured data — keep as-is for len() etc.
      safe[key] = value
    } else if (depth === 0) {
      // Wrap scalar values (string, number, boolean) with _raw at depth 0
      // so conditions like outputs.node._raw always work
      safe[key] = addReservedAliases({ _raw: typeof value === 'string' ? value : String(value) })
    } else {
      safe[key] = value
    }
  }
  return addReservedAliases(safe)
}

/**
 * Pre-populate missing node IDs in outputs with { _raw: '' } so expr-eval
 * doesn't throw when accessing `outputs.nodeId._raw` for a node that hasn't
 * produced output yet. Extracts referenced IDs from the preprocessed expression.
 */
function ensureReferencedOutputs(
  outputs: Record<string, unknown>,
  processedExpr: string
): Record<string, unknown> {
  const refs = processedExpr.matchAll(/outputs\.(\w+)/g)
  for (const match of refs) {
    const nodeId = match[1]!
    if (!(nodeId in outputs)) {
      outputs[nodeId] = { _raw: '' }
    }
  }
  return outputs
}

/**
 * Build evaluation scope from context
 */
function buildEvalScope(
  context: EvalContext,
  processedExpr?: string
): Record<string, unknown> {
  const outputs = safeOutputs((context.outputs as Record<string, unknown>) ?? {})
  if (processedExpr) {
    ensureReferencedOutputs(outputs, processedExpr)
  }

  const variables = addReservedAliases({ ...(context.variables ?? {}) })
  const inputs = addReservedAliases({ ...(context.inputs ?? {}) })

  const scope: Record<string, unknown> = {
    outputs,
    variables,
    loopCount: context.loopCount ?? 0,
    nodeStates: context.nodeStates ?? {},
    inputs,
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
  const processed = preprocessExpression(expression)
  try {
    const expr = parser.parse(processed)
    const scope = buildEvalScope(context, processed)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return expr.evaluate(scope as any)
  } catch (error) {
    const extra = processed !== expression ? ` (preprocessed: "${processed}")` : ''
    logger.error(`Failed to evaluate expression: "${expression}"${extra}`, error)
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
  } catch (error) {
    logger.warn(`Condition evaluation failed for "${expression}": ${formatErrorMessage(error)}`)
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
      error: formatErrorMessage(error),
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
