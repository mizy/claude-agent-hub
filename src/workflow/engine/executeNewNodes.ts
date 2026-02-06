/**
 * 新节点类型执行器
 * 为 delay, schedule, loop, switch, assign, script, foreach 节点提供执行逻辑
 */

import { Parser } from 'expr-eval'
import { createLogger } from '../../shared/logger.js'
import { evaluateCondition } from './ConditionEvaluator.js'
import type {
  WorkflowNode,
  WorkflowInstance,
  EvalContext,
} from '../types.js'

const logger = createLogger('node-executor')

// 创建通用表达式 Parser
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

// 添加内置函数
parser.functions.len = (arr: unknown[]) => Array.isArray(arr) ? arr.length : 0
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
 * 通用表达式求值
 */
export function evaluateExpression(
  expression: string,
  context: EvalContext
): unknown {
  try {
    // 预处理表达式
    let processed = expression.trim()

    // 将 JavaScript 全局对象方法调用转换为内置函数
    processed = processed.replace(/Date\.now\(\)/g, 'now()')
    processed = processed.replace(/Math\.floor\(/g, 'floor(')
    processed = processed.replace(/Math\.ceil\(/g, 'ceil(')
    processed = processed.replace(/Math\.round\(/g, 'round(')
    processed = processed.replace(/Math\.min\(/g, 'min(')
    processed = processed.replace(/Math\.max\(/g, 'max(')
    processed = processed.replace(/Math\.abs\(/g, 'abs(')

    // 逻辑运算符
    processed = processed.replace(/&&/g, ' and ')
    processed = processed.replace(/\|\|/g, ' or ')
    processed = processed.replace(/!/g, ' not ')

    const expr = parser.parse(processed)

    const evalScope: Record<string, unknown> = {
      outputs: context.outputs ?? {},
      variables: context.variables ?? {},
      loopCount: context.loopCount ?? 0,
      nodeStates: context.nodeStates ?? {},
      inputs: context.inputs ?? {},
      true: true,
      false: false,
      null: null,
    }

    // 添加 loopContext
    if (context.loopContext) {
      evalScope.index = context.loopContext.index
      evalScope.item = context.loopContext.item
      evalScope.total = context.loopContext.total
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return expr.evaluate(evalScope as any)
  } catch (error) {
    logger.error(`Failed to evaluate expression: "${expression}"`, error)
    throw error
  }
}

// ============ Delay Node ============

export interface DelayResult {
  success: boolean
  delayMs: number
  error?: string
}

export function executeDelayNode(
  node: WorkflowNode,
  _instance: WorkflowInstance
): DelayResult {
  const config = node.delay
  if (!config) {
    return { success: false, delayMs: 0, error: 'Delay config missing' }
  }

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  const delayMs = config.value * (multipliers[config.unit] || 1000)

  logger.info(`Delay node ${node.id}: waiting ${config.value}${config.unit} (${delayMs}ms)`)

  return { success: true, delayMs }
}

// ============ Schedule Node ============

export interface ScheduleResult {
  success: boolean
  waitUntil?: Date
  error?: string
}

export function executeScheduleNode(
  node: WorkflowNode,
  _instance: WorkflowInstance
): ScheduleResult {
  const config = node.schedule
  if (!config) {
    return { success: false, error: 'Schedule config missing' }
  }

  if (config.datetime) {
    const targetDate = new Date(config.datetime)
    if (isNaN(targetDate.getTime())) {
      return { success: false, error: `Invalid datetime: ${config.datetime}` }
    }

    if (targetDate > new Date()) {
      logger.info(`Schedule node ${node.id}: waiting until ${config.datetime}`)
      return { success: true, waitUntil: targetDate }
    }

    // 已经过期，立即继续
    logger.info(`Schedule node ${node.id}: datetime already passed, continuing`)
    return { success: true }
  }

  if (config.cron) {
    // 计算下一次 cron 执行时间
    // TODO: 使用 cron-parser 库
    const nextTime = calculateNextCronTime(config.cron, config.timezone)
    if (nextTime) {
      logger.info(`Schedule node ${node.id}: waiting for cron ${config.cron}`)
      return { success: true, waitUntil: nextTime }
    }
    return { success: false, error: `Invalid cron expression: ${config.cron}` }
  }

  return { success: false, error: 'Schedule node requires cron or datetime' }
}

/**
 * 计算下一次 cron 执行时间
 * 简化实现，只支持基本的 cron 表达式
 */
function calculateNextCronTime(cron: string, _timezone?: string): Date | null {
  // 基本实现：解析简单的 cron 表达式
  // 格式: 分 时 日 月 周
  const parts = cron.split(' ')
  if (parts.length !== 5) {
    return null
  }

  // 简化实现：返回下一个整点
  const now = new Date()
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)

  return next
}

// ============ Switch Node ============

export interface SwitchResult {
  success: boolean
  targetNode?: string
  error?: string
}

export function executeSwitchNode(
  node: WorkflowNode,
  instance: WorkflowInstance,
  context: EvalContext
): SwitchResult {
  const config = node.switch
  if (!config) {
    return { success: false, error: 'Switch config missing' }
  }

  try {
    const value = evaluateExpression(config.expression, context)

    logger.debug(`Switch node ${node.id}: expression "${config.expression}" = ${value}`)

    // 查找匹配的 case
    for (const caseItem of config.cases) {
      if (caseItem.value === 'default') continue
      if (caseItem.value === value) {
        logger.info(`Switch node ${node.id}: matched case ${caseItem.value} → ${caseItem.targetNode}`)
        return { success: true, targetNode: caseItem.targetNode }
      }
    }

    // 查找 default case
    const defaultCase = config.cases.find(c => c.value === 'default')
    if (defaultCase) {
      logger.info(`Switch node ${node.id}: using default → ${defaultCase.targetNode}`)
      return { success: true, targetNode: defaultCase.targetNode }
    }
    if (config.defaultTarget) {
      logger.info(`Switch node ${node.id}: using defaultTarget → ${config.defaultTarget}`)
      return { success: true, targetNode: config.defaultTarget }
    }

    return { success: false, error: `No matching case for value: ${value}` }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ============ Assign Node ============

export interface AssignResult {
  success: boolean
  updates: Record<string, unknown>
  error?: string
}

export function executeAssignNode(
  node: WorkflowNode,
  instance: WorkflowInstance,
  context: EvalContext
): AssignResult {
  const config = node.assign
  if (!config) {
    return { success: false, updates: {}, error: 'Assign config missing' }
  }

  const updates: Record<string, unknown> = {}

  try {
    for (const assignment of config.assignments) {
      let value = assignment.value

      if (assignment.isExpression && typeof value === 'string') {
        value = evaluateExpression(value, context)
      }

      updates[assignment.variable] = value
      logger.debug(`Assign node ${node.id}: ${assignment.variable} = ${JSON.stringify(value)}`)
    }

    logger.info(`Assign node ${node.id}: updated ${Object.keys(updates).length} variables`)
    return { success: true, updates }
  } catch (error) {
    return { success: false, updates: {}, error: String(error) }
  }
}

// ============ Script Node ============

export interface ScriptResult {
  success: boolean
  result?: unknown
  outputVar?: string
  /** 多变量更新（assignments 模式） */
  updates?: Record<string, unknown>
  error?: string
}

export function executeScriptNode(
  node: WorkflowNode,
  instance: WorkflowInstance,
  context: EvalContext
): ScriptResult {
  const config = node.script
  if (!config) {
    return { success: false, error: 'Script config missing' }
  }

  try {
    // 模式 1：多变量赋值（assignments）
    if (config.assignments && config.assignments.length > 0) {
      const updates: Record<string, unknown> = {}

      for (const assignment of config.assignments) {
        const value = evaluateExpression(assignment.expression, context)
        updates[assignment.variable] = value
        logger.debug(`Script node ${node.id}: ${assignment.variable} = ${JSON.stringify(value)}`)
      }

      logger.info(`Script node ${node.id}: updated ${Object.keys(updates).length} variables via assignments`)
      return {
        success: true,
        updates,
        result: updates,
      }
    }

    // 模式 2：单表达式模式（向后兼容）
    if (!config.expression) {
      return { success: false, error: 'Script config requires either expression or assignments' }
    }

    const result = evaluateExpression(config.expression, context)

    logger.info(`Script node ${node.id}: "${config.expression}" = ${JSON.stringify(result)}`)

    return {
      success: true,
      result,
      outputVar: config.outputVar,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ============ Loop Node ============

export interface LoopResult {
  success: boolean
  shouldContinue: boolean
  loopVar?: string
  loopValue?: unknown
  bodyNodes?: string[]
  error?: string
}

export function executeLoopNode(
  node: WorkflowNode,
  instance: WorkflowInstance,
  context: EvalContext
): LoopResult {
  const config = node.loop
  if (!config) {
    return { success: false, shouldContinue: false, error: 'Loop config missing' }
  }

  const loopVar = config.loopVar || 'i'
  const currentValue = context.variables[loopVar] as number | undefined

  // 检查最大迭代次数
  const iterations = context.loopContext?.index ?? 0
  if (config.maxIterations && iterations >= config.maxIterations) {
    logger.warn(`Loop node ${node.id}: reached max iterations (${config.maxIterations})`)
    return { success: true, shouldContinue: false }
  }

  switch (config.type) {
    case 'while': {
      if (!config.condition) {
        return { success: false, shouldContinue: false, error: 'While loop requires condition' }
      }
      const shouldContinue = evaluateCondition(config.condition, context)
      logger.debug(`Loop node ${node.id} (while): condition = ${shouldContinue}`)
      return {
        success: true,
        shouldContinue,
        bodyNodes: config.bodyNodes,
      }
    }

    case 'until': {
      if (!config.condition) {
        return { success: false, shouldContinue: false, error: 'Until loop requires condition' }
      }
      const shouldStop = evaluateCondition(config.condition, context)
      logger.debug(`Loop node ${node.id} (until): stop condition = ${shouldStop}`)
      return {
        success: true,
        shouldContinue: !shouldStop,
        bodyNodes: config.bodyNodes,
      }
    }

    case 'for': {
      const init = config.init ?? 0
      const end = config.end
      const step = config.step ?? 1

      if (end === undefined) {
        return { success: false, shouldContinue: false, error: 'For loop requires end value' }
      }

      const current = currentValue ?? init

      const shouldContinue = (step > 0 && current < end) || (step < 0 && current > end)

      logger.debug(`Loop node ${node.id} (for): ${loopVar}=${current}, end=${end}, continue=${shouldContinue}`)

      return {
        success: true,
        shouldContinue,
        loopVar,
        loopValue: current,
        bodyNodes: config.bodyNodes,
      }
    }

    default:
      return { success: false, shouldContinue: false, error: `Unknown loop type: ${config.type}` }
  }
}

// ============ Foreach Node ============

export interface ForeachResult {
  success: boolean
  items?: unknown[]
  itemVar?: string
  indexVar?: string
  bodyNodes?: string[]
  mode?: 'sequential' | 'parallel'
  maxParallel?: number
  error?: string
}

export function executeForeachNode(
  node: WorkflowNode,
  instance: WorkflowInstance,
  context: EvalContext
): ForeachResult {
  const config = node.foreach
  if (!config) {
    return { success: false, error: 'Foreach config missing' }
  }

  try {
    const collection = evaluateExpression(config.collection, context)

    if (!Array.isArray(collection)) {
      return { success: false, error: `Collection must be an array, got: ${typeof collection}` }
    }

    // 检查最大迭代次数
    if (config.maxIterations && collection.length > config.maxIterations) {
      logger.warn(`Foreach node ${node.id}: collection size (${collection.length}) exceeds max (${config.maxIterations})`)
      return {
        success: false,
        error: `Collection size (${collection.length}) exceeds maxIterations (${config.maxIterations})`,
      }
    }

    logger.info(`Foreach node ${node.id}: iterating over ${collection.length} items`)

    return {
      success: true,
      items: collection,
      itemVar: config.itemVar || 'item',
      indexVar: config.indexVar || 'index',
      bodyNodes: config.bodyNodes,
      mode: config.mode || 'sequential',
      maxParallel: config.maxParallel,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
