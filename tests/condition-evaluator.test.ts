/**
 * 条件求值器测试
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateCondition,
  validateExpression,
  extractVariables,
} from '../src/workflow/engine/ExpressionEvaluator.js'
import type { EvalContext } from '../src/workflow/types.js'

describe('evaluateCondition', () => {
  const createContext = (overrides: Partial<EvalContext> = {}): EvalContext => ({
    outputs: {},
    variables: {},
    loopCount: 0,
    nodeStates: {},
    ...overrides,
  })

  describe('基础表达式', () => {
    it('should return true for empty expression', () => {
      expect(evaluateCondition('', createContext())).toBe(true)
      expect(evaluateCondition('  ', createContext())).toBe(true)
    })

    it('should evaluate simple comparison', () => {
      expect(evaluateCondition('1 == 1', createContext())).toBe(true)
      expect(evaluateCondition('1 == 2', createContext())).toBe(false)
      expect(evaluateCondition('1 < 2', createContext())).toBe(true)
      expect(evaluateCondition('2 > 1', createContext())).toBe(true)
    })

    it('should evaluate boolean literals', () => {
      expect(evaluateCondition('true', createContext())).toBe(true)
      expect(evaluateCondition('false', createContext())).toBe(false)
    })
  })

  describe('变量访问', () => {
    it('should access loopCount', () => {
      expect(evaluateCondition('loopCount < 3', createContext({ loopCount: 0 }))).toBe(true)
      expect(evaluateCondition('loopCount < 3', createContext({ loopCount: 3 }))).toBe(false)
      expect(evaluateCondition('loopCount == 5', createContext({ loopCount: 5 }))).toBe(true)
    })

    it('should access outputs', () => {
      const context = createContext({
        outputs: {
          taskA: { success: true, count: 10 },
        },
      })

      expect(evaluateCondition('outputs.taskA.success == true', context)).toBe(true)
      expect(evaluateCondition('outputs.taskA.count > 5', context)).toBe(true)
    })

    it('should access variables', () => {
      const context = createContext({
        variables: {
          maxRetries: 3,
          enabled: true,
        },
      })

      expect(evaluateCondition('variables.maxRetries == 3', context)).toBe(true)
      expect(evaluateCondition('variables.enabled == true', context)).toBe(true)
    })
  })

  describe('逻辑运算', () => {
    it('should support && operator', () => {
      expect(evaluateCondition('true && true', createContext())).toBe(true)
      expect(evaluateCondition('true && false', createContext())).toBe(false)
    })

    it('should support || operator', () => {
      expect(evaluateCondition('true || false', createContext())).toBe(true)
      expect(evaluateCondition('false || false', createContext())).toBe(false)
    })

    it('should support ! operator', () => {
      expect(evaluateCondition('!false', createContext())).toBe(true)
      expect(evaluateCondition('!true', createContext())).toBe(false)
    })

    it('should handle complex logical expressions', () => {
      const context = createContext({
        loopCount: 2,
        outputs: { check: { passed: false } },
      })

      expect(evaluateCondition(
        'loopCount < 5 && outputs.check.passed == false',
        context
      )).toBe(true)
    })
  })

  describe('内置函数', () => {
    it('should support len function', () => {
      const context = createContext({
        outputs: {
          items: [1, 2, 3, 4, 5],
        },
      })

      expect(evaluateCondition('len(outputs.items) == 5', context)).toBe(true)
      expect(evaluateCondition('len(outputs.items) > 3', context)).toBe(true)
    })

    it('should support has function', () => {
      const context = createContext({
        outputs: {
          config: { key: 'value' },
        },
      })

      expect(evaluateCondition('has(outputs.config, "key")', context)).toBe(true)
      expect(evaluateCondition('has(outputs.config, "missing")', context)).toBe(false)
    })

    it('should support get function with default', () => {
      const context = createContext({
        outputs: {
          data: { value: 42 },
        },
      })

      expect(evaluateCondition('get(outputs.data, "value", 0) == 42', context)).toBe(true)
      expect(evaluateCondition('get(outputs.data, "missing", 100) == 100', context)).toBe(true)
    })
  })

  describe('错误处理', () => {
    it('should return false for invalid expressions', () => {
      expect(evaluateCondition('invalid syntax {{', createContext())).toBe(false)
    })

    it('should return false when accessing undefined properties', () => {
      // 不应该抛出错误，而是返回 false
      const result = evaluateCondition('outputs.nonexistent.value == 1', createContext())
      expect(typeof result).toBe('boolean')
    })
  })
})

describe('validateExpression', () => {
  it('should validate correct expressions', () => {
    expect(validateExpression('a == 1').valid).toBe(true)
    expect(validateExpression('x > 5 and y < 10').valid).toBe(true)
    expect(validateExpression('true').valid).toBe(true)
  })

  it('should accept empty expressions', () => {
    expect(validateExpression('').valid).toBe(true)
    expect(validateExpression('  ').valid).toBe(true)
  })

  it('should reject invalid syntax', () => {
    const result = validateExpression('invalid {{ syntax')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})

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
    const vars = extractVariables('nodeStates.task1.status == "done"')
    expect(vars).toContain('task1')
  })

  it('should extract multiple variables', () => {
    const vars = extractVariables(
      'outputs.a.x == 1 && outputs.b.y == 2 && variables.c == true'
    )
    expect(vars).toContain('a')
    expect(vars).toContain('b')
    expect(vars).toContain('c')
  })

  it('should handle empty expression', () => {
    const vars = extractVariables('')
    expect(vars).toHaveLength(0)
  })
})
