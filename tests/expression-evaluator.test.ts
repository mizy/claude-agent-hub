/**
 * ExpressionEvaluator 测试
 *
 * 重点覆盖：
 * - preprocessExpression 运算符转换
 * - ! 不影响 != 和 !== (iter1 修复的 P0 bug)
 * - evaluateExpression 各种表达式
 * - evaluateCondition 边界条件
 * - validateExpression 语法校验
 * - extractVariables 变量提取
 * - 内置函数调用
 */

import { describe, it, expect } from 'vitest'
import {
  preprocessExpression,
  evaluateExpression,
  evaluateCondition,
  validateExpression,
  extractVariables,
} from '../src/workflow/engine/ExpressionEvaluator.js'
import type { EvalContext } from '../src/workflow/types.js'

const emptyContext: EvalContext = {
  outputs: {},
  variables: {},
  loopCount: 0,
  nodeStates: {},
}

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return { ...emptyContext, ...overrides }
}

// ============ preprocessExpression ============

describe('preprocessExpression', () => {
  it('should trim whitespace', () => {
    expect(preprocessExpression('  x == 1  ')).toBe('x == 1')
  })

  it('should replace && with and', () => {
    expect(preprocessExpression('a && b')).toBe('a  and  b')
  })

  it('should replace || with or', () => {
    expect(preprocessExpression('a || b')).toBe('a  or  b')
  })

  it('should replace ! with not (P0 fix)', () => {
    expect(preprocessExpression('!a')).toBe(' not a')
  })

  it('should NOT replace != (P0 fix - critical)', () => {
    const result = preprocessExpression('a != b')
    expect(result).toBe('a != b')
    expect(result).not.toContain('not')
  })

  it('should NOT replace !== (P0 fix - critical)', () => {
    const result = preprocessExpression('a !== b')
    // !== becomes != after regex (since !(?!=) won't match ! followed by =)
    expect(result).not.toContain('not')
  })

  it('should handle ! before parentheses', () => {
    const result = preprocessExpression('!(a && b)')
    expect(result).toContain('not')
  })

  it('should handle mixed ! and != in same expression', () => {
    const result = preprocessExpression('!done && status != "failed"')
    // ! before done should become "not", but != should stay as !=
    expect(result).toContain('not')
    expect(result).toContain('!=')
  })

  it('should replace Date.now()', () => {
    expect(preprocessExpression('Date.now()')).toBe('now()')
  })

  it('should replace Math functions', () => {
    expect(preprocessExpression('Math.floor(x)')).toBe('floor(x)')
    expect(preprocessExpression('Math.ceil(x)')).toBe('ceil(x)')
    expect(preprocessExpression('Math.round(x)')).toBe('round(x)')
    expect(preprocessExpression('Math.min(a, b)')).toBe('min(a, b)')
    expect(preprocessExpression('Math.max(a, b)')).toBe('max(a, b)')
    expect(preprocessExpression('Math.abs(x)')).toBe('abs(x)')
  })

  it('should handle complex expression with multiple replacements', () => {
    const result = preprocessExpression('x > 0 && Math.abs(x) < 10 || !finished')
    expect(result).toContain('and')
    expect(result).toContain('abs(x)')
    expect(result).toContain('or')
    expect(result).toContain('not')
  })

  // Bracket notation support (fixes workflow dead-end failures with hyphenated node IDs)
  it('should convert single-quote bracket notation to dot with underscore', () => {
    expect(preprocessExpression("outputs['verify-consistency']._raw")).toBe(
      'outputs.verify_consistency._raw'
    )
  })

  it('should convert double-quote bracket notation to dot with underscore', () => {
    expect(preprocessExpression('outputs["review-signal-detector"]._raw')).toBe(
      'outputs.review_signal_detector._raw'
    )
  })

  it('should handle bracket notation without hyphens', () => {
    expect(preprocessExpression("outputs['review']._raw")).toBe('outputs.review._raw')
  })

  it('should handle bracket notation with includes() method call', () => {
    const result = preprocessExpression(
      "outputs['verify-consistency']._raw.includes('APPROVED')"
    )
    expect(result).toContain('includes(outputs.verify_consistency._raw')
    expect(result).toContain("'APPROVED'")
  })

  it('should handle negated bracket notation expression', () => {
    const result = preprocessExpression(
      "!outputs['review']._raw.includes('APPROVED')"
    )
    expect(result).toContain('not')
    expect(result).toContain('includes(outputs.review._raw')
  })

  it('should handle chained .toLowerCase().includes() calls', () => {
    const result = preprocessExpression(
      "outputs.review._raw.toLowerCase().includes('approved')"
    )
    expect(result).toBe("includes(lower(outputs.review._raw), 'approved')")
  })

  it('should handle chained .toUpperCase().startsWith() calls', () => {
    const result = preprocessExpression(
      "outputs.node._raw.toUpperCase().startsWith('OK')"
    )
    expect(result).toBe("startsWith(upper(outputs.node._raw), 'OK')")
  })

  // Reserved word escaping (expr-eval treats round/floor/etc as built-in tokens)
  it('should escape reserved words used as property names', () => {
    expect(preprocessExpression('variables.round + 1')).toBe('variables.__round + 1')
    expect(preprocessExpression('variables.floor')).toBe('variables.__floor')
    expect(preprocessExpression('variables.log')).toBe('variables.__log')
    expect(preprocessExpression('variables.length')).toBe('variables.__length')
  })

  it('should NOT escape reserved words when used as function calls', () => {
    expect(preprocessExpression('round(3.5)')).toBe('round(3.5)')
    expect(preprocessExpression('floor(x)')).toBe('floor(x)')
    expect(preprocessExpression('abs(-5)')).toBe('abs(-5)')
  })

  it('should NOT escape Math.round() — function call pattern', () => {
    // Math.round(x) should stay as Math.round(x) (later replaced to round(x))
    const result = preprocessExpression('Math.round(x)')
    expect(result).toBe('round(x)')
  })

  it('should handle mixed reserved property and function in same expression', () => {
    // variables.round is a property → escape; round(x) is a function call → keep
    const result = preprocessExpression('variables.round + round(3.5)')
    expect(result).toContain('variables.__round')
    expect(result).toContain('round(3.5)')
  })

  it('should not escape non-reserved property names', () => {
    expect(preprocessExpression('variables.count')).toBe('variables.count')
    expect(preprocessExpression('outputs.taskA._raw')).toBe('outputs.taskA._raw')
  })
})

// ============ evaluateExpression ============

describe('evaluateExpression', () => {
  it('should evaluate arithmetic', () => {
    expect(evaluateExpression('1 + 2', emptyContext)).toBe(3)
    expect(evaluateExpression('10 - 3', emptyContext)).toBe(7)
    expect(evaluateExpression('4 * 5', emptyContext)).toBe(20)
    expect(evaluateExpression('15 / 3', emptyContext)).toBe(5)
  })

  it('should evaluate comparisons', () => {
    expect(evaluateExpression('5 > 3', emptyContext)).toBe(true)
    expect(evaluateExpression('3 < 5', emptyContext)).toBe(true)
    expect(evaluateExpression('3 == 3', emptyContext)).toBe(true)
    expect(evaluateExpression('3 != 4', emptyContext)).toBe(true)
  })

  it('should access outputs', () => {
    const context = ctx({
      outputs: { taskA: { _raw: 42, items: [1, 2, 3] } },
    })
    // outputs.X.result is aliased to outputs.X._raw by preprocessExpression
    expect(evaluateExpression('outputs.taskA.result', context)).toBe(42)
  })

  it('should access variables', () => {
    const context = ctx({ variables: { count: 10, name: 'test' } })
    expect(evaluateExpression('variables.count + 5', context)).toBe(15)
  })

  it('should access loopCount', () => {
    const context = ctx({ loopCount: 7 })
    expect(evaluateExpression('loopCount', context)).toBe(7)
  })

  it('should access loop context', () => {
    const context = ctx({
      loopContext: { index: 2, item: 'hello', total: 5 },
    })
    expect(evaluateExpression('index', context)).toBe(2)
    expect(evaluateExpression('total', context)).toBe(5)
  })

  it('should evaluate boolean literals', () => {
    expect(evaluateExpression('true', emptyContext)).toBe(true)
    expect(evaluateExpression('false', emptyContext)).toBe(false)
  })

  it('should evaluate null', () => {
    expect(evaluateExpression('null', emptyContext)).toBe(null)
  })

  it('should throw on invalid expression', () => {
    expect(() => evaluateExpression('invalid {{ syntax', emptyContext)).toThrow()
  })

  // Reserved word property access (e.g. variables.round)
  it('should access variables with reserved word names (round, floor, log)', () => {
    const context = ctx({ variables: { round: 3, floor: 1, log: 'info' } })
    expect(evaluateExpression('variables.round + 1', context)).toBe(4)
    expect(evaluateExpression('variables.floor', context)).toBe(1)
  })

  it('should use reserved words as functions AND property names in same expr', () => {
    const context = ctx({ variables: { round: 3 } })
    // variables.round is property access (=3), round(2.7) is function call (=3)
    expect(evaluateExpression('variables.round + round(2.7)', context)).toBe(6)
  })

  // Built-in functions
  it('should support len()', () => {
    const context = ctx({ outputs: { list: [1, 2, 3, 4] } })
    expect(evaluateExpression('len(outputs.list)', context)).toBe(4)
  })

  it('should return 0 for len() on non-array', () => {
    expect(evaluateExpression('len(null)', emptyContext)).toBe(0)
  })

  it('should support has()', () => {
    const context = ctx({ outputs: { obj: { key: 'val' } } })
    expect(evaluateExpression('has(outputs.obj, "key")', context)).toBe(true)
    expect(evaluateExpression('has(outputs.obj, "missing")', context)).toBe(false)
  })

  it('should support get() with default', () => {
    const context = ctx({ outputs: { data: { x: 42 } } })
    expect(evaluateExpression('get(outputs.data, "x", 0)', context)).toBe(42)
    expect(evaluateExpression('get(outputs.data, "y", 99)', context)).toBe(99)
  })

  it('should support str()', () => {
    expect(evaluateExpression('str(42)', emptyContext)).toBe('42')
  })

  it('should support num()', () => {
    expect(evaluateExpression('num("42")', emptyContext)).toBe(42)
  })

  it('should support math functions', () => {
    expect(evaluateExpression('floor(3.7)', emptyContext)).toBe(3)
    expect(evaluateExpression('ceil(3.2)', emptyContext)).toBe(4)
    expect(evaluateExpression('round(3.5)', emptyContext)).toBe(4)
    expect(evaluateExpression('abs(-5)', emptyContext)).toBe(5)
    expect(evaluateExpression('min(3, 7)', emptyContext)).toBe(3)
    expect(evaluateExpression('max(3, 7)', emptyContext)).toBe(7)
  })

  it('should support now() function', () => {
    const result = evaluateExpression('now()', emptyContext)
    expect(typeof result).toBe('number')
    expect(result as number).toBeGreaterThan(0)
  })
})

// ============ evaluateCondition ============

describe('evaluateCondition', () => {
  it('should return true for empty/whitespace expressions', () => {
    expect(evaluateCondition('', emptyContext)).toBe(true)
    expect(evaluateCondition('   ', emptyContext)).toBe(true)
  })

  it('should return false for invalid expressions (no throw)', () => {
    expect(evaluateCondition('{{ invalid }}', emptyContext)).toBe(false)
  })

  it('should evaluate != correctly (P0 regression test)', () => {
    const context = ctx({
      variables: { status: 'running' },
    })
    // This was broken before iter1 fix: !('=') was being replaced
    expect(evaluateCondition('variables.status != "done"', context)).toBe(true)
  })

  it('should evaluate logical operators', () => {
    expect(evaluateCondition('true && true', emptyContext)).toBe(true)
    expect(evaluateCondition('true && false', emptyContext)).toBe(false)
    expect(evaluateCondition('false || true', emptyContext)).toBe(true)
    expect(evaluateCondition('!false', emptyContext)).toBe(true)
    expect(evaluateCondition('!true', emptyContext)).toBe(false)
  })

  it('should coerce truthy/falsy values to boolean', () => {
    expect(evaluateCondition('1', emptyContext)).toBe(true)
    expect(evaluateCondition('0', emptyContext)).toBe(false)
  })

  it('should evaluate conditions with reserved word variable names', () => {
    const context = ctx({ variables: { round: 2 } })
    expect(evaluateCondition('variables.round < 5', context)).toBe(true)
    expect(evaluateCondition('variables.round == 2', context)).toBe(true)
    expect(evaluateCondition('variables.round > 10', context)).toBe(false)
  })

  it('should handle complex conditions with outputs and variables', () => {
    const context = ctx({
      outputs: { check: { passed: true } },
      variables: { maxRetries: 3 },
      loopCount: 2,
    })
    expect(
      evaluateCondition(
        'outputs.check.passed == true && loopCount < variables.maxRetries',
        context
      )
    ).toBe(true)
  })
})

// ============ bracket notation with evaluateCondition (integration) ============

describe('evaluateCondition with bracket notation', () => {
  it('should evaluate bracket-notation expression for APPROVED output', () => {
    const context = ctx({
      outputs: {
        // createHyphenAliases creates verify_consistency from verify-consistency
        'verify-consistency': { _raw: 'APPROVED — all checks passed' },
        verify_consistency: { _raw: 'APPROVED — all checks passed' },
      },
    })
    expect(
      evaluateCondition(
        "outputs['verify-consistency']._raw.includes('APPROVED')",
        context
      )
    ).toBe(true)
  })

  it('should evaluate bracket-notation expression for REJECTED output', () => {
    const context = ctx({
      outputs: {
        'review-code': { _raw: 'REJECTED — needs fixes' },
        review_code: { _raw: 'REJECTED — needs fixes' },
      },
    })
    expect(
      evaluateCondition(
        "!outputs['review-code']._raw.includes('APPROVED')",
        context
      )
    ).toBe(true)
  })

  it('should not throw when referenced output node is missing (ensureReferencedOutputs)', () => {
    // When a node hasn't produced output yet, evaluateCondition should return false
    // instead of throwing. ensureReferencedOutputs auto-populates { _raw: '' }.
    const context = ctx({ outputs: {} })
    expect(
      evaluateCondition("outputs.review._raw.includes('APPROVED')", context)
    ).toBe(false)
  })

  it('should auto-populate missing node outputs for bracket notation expressions', () => {
    const context = ctx({ outputs: {} })
    expect(
      evaluateCondition(
        "outputs['verify-consistency']._raw.includes('APPROVED')",
        context
      )
    ).toBe(false)
  })

  it('should handle null/undefined node outputs with _raw wrapper', () => {
    // When a node output is null or undefined (e.g. control nodes),
    // safeOutputs should still wrap it with { _raw: '' } at depth 0
    const context = ctx({ outputs: { review: null } })
    expect(
      evaluateCondition("outputs.review._raw.includes('APPROVED')", context)
    ).toBe(false)
    // Should not throw, and _raw should be accessible as empty string
    expect(
      evaluateCondition("!outputs.review._raw.includes('APPROVED')", context)
    ).toBe(true)
  })

  it('should handle undefined node outputs with _raw wrapper', () => {
    const context = ctx({ outputs: { review: undefined } })
    expect(
      evaluateCondition("outputs.review._raw.includes('APPROVED')", context)
    ).toBe(false)
  })
})

// ============ validateExpression ============

describe('validateExpression', () => {
  it('should accept valid expressions', () => {
    expect(validateExpression('x + 1').valid).toBe(true)
    expect(validateExpression('a > 5 and b < 10').valid).toBe(true)
    expect(validateExpression('true').valid).toBe(true)
    expect(validateExpression('len(x) > 0').valid).toBe(true)
  })

  it('should accept empty expressions', () => {
    expect(validateExpression('').valid).toBe(true)
    expect(validateExpression('  ').valid).toBe(true)
  })

  it('should reject invalid syntax', () => {
    const result = validateExpression('{{ invalid syntax')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe('string')
  })
})

// ============ extractVariables ============

describe('extractVariables', () => {
  it('should extract outputs references', () => {
    const vars = extractVariables('outputs.taskA.result == true')
    expect(vars).toContain('taskA')
  })

  it('should extract variables references', () => {
    const vars = extractVariables('variables.maxRetries > 3')
    expect(vars).toContain('maxRetries')
  })

  it('should extract nodeStates references', () => {
    const vars = extractVariables('nodeStates.node1.status == "done"')
    expect(vars).toContain('node1')
  })

  it('should extract multiple references from complex expression', () => {
    const vars = extractVariables(
      'outputs.a.x > 0 && variables.b == true && nodeStates.c.status == "done"'
    )
    expect(vars).toContain('a')
    expect(vars).toContain('b')
    expect(vars).toContain('c')
    expect(vars).toHaveLength(3)
  })

  it('should deduplicate references', () => {
    const vars = extractVariables('outputs.x.a + outputs.x.b')
    expect(vars.filter(v => v === 'x')).toHaveLength(1)
  })

  it('should return empty for empty expression', () => {
    expect(extractVariables('')).toHaveLength(0)
  })

  it('should return empty for expressions without variable refs', () => {
    expect(extractVariables('1 + 2 > 0')).toHaveLength(0)
  })
})
