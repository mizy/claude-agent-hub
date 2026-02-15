/**
 * CLI trace 子命令 — 展示完整调用链路和成本归因
 *
 * Usage:
 *   cah task trace <taskId>
 *   cah task trace <taskId> --slow 2000
 *   cah task trace <taskId> --errors
 *   cah task trace <taskId> --cost
 *   cah task trace <taskId> --export
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { getTrace, listTraces, querySlowSpans } from '../../store/TraceStore.js'
import { exportTraceToOTLP } from '../../store/exportOTLP.js'
import { getTask } from '../../store/TaskStore.js'
import { formatDuration } from '../../shared/formatTime.js'
import { error, info, success, warn } from '../output.js'
import type { Span, Trace } from '../../types/trace.js'

// ============ Tree rendering ============

/** Tree branch characters */
const TREE = {
  pipe: '│  ',
  tee: '├─ ',
  last: '└─ ',
  blank: '   ',
} as const

/** Build parent→children map from flat span list */
function buildSpanTree(spans: Span[]): Map<string | undefined, Span[]> {
  const children = new Map<string | undefined, Span[]>()
  for (const span of spans) {
    const key = span.parentSpanId ?? undefined
    const list = children.get(key)
    if (list) {
      list.push(span)
    } else {
      children.set(key, [span])
    }
  }
  return children
}

/** Format a single span line */
function formatSpanLine(span: Span): string {
  const status =
    span.status === 'error'
      ? chalk.red('ERR')
      : span.status === 'running'
        ? chalk.yellow('RUN')
        : chalk.green('OK ')

  const duration = span.durationMs != null ? chalk.gray(formatDuration(span.durationMs)) : chalk.gray('...')

  const kindTag = chalk.dim(`[${span.kind}]`)

  let extra = ''
  if (span.tokenUsage) {
    extra += chalk.cyan(` ${span.tokenUsage.totalTokens}tok`)
  }
  if (span.cost) {
    extra += chalk.yellow(` $${span.cost.amount.toFixed(4)}`)
  }

  const name =
    span.status === 'error'
      ? chalk.red(span.name)
      : span.durationMs != null && span.durationMs > 30000
        ? chalk.yellow(span.name)
        : span.name

  return `${status} ${kindTag} ${name}  ${duration}${extra}`
}

/** Recursively print span tree */
function printSpanTree(
  spanId: string | undefined,
  children: Map<string | undefined, Span[]>,
  prefix: string,
  isLast: boolean,
  isRoot: boolean
): void {
  const siblings = children.get(spanId) ?? []

  for (let i = 0; i < siblings.length; i++) {
    const span = siblings[i]!
    const last = i === siblings.length - 1

    if (isRoot) {
      // Root span — no prefix
      console.log(formatSpanLine(span))
    } else {
      const branch = last ? TREE.last : TREE.tee
      console.log(prefix + branch + formatSpanLine(span))
    }

    // Recurse into children
    const childPrefix = isRoot ? '' : prefix + (last ? TREE.blank : TREE.pipe)
    printSpanTree(span.spanId, children, childPrefix, last, false)
  }
}

// ============ Cost attribution ============

interface NodeCost {
  name: string
  kind: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cost: number
  llmCalls: number
}

/** Aggregate costs by node span */
function aggregateCosts(trace: Trace): NodeCost[] {
  const nodeMap = new Map<string, NodeCost>()

  // Find node-level spans
  const nodeSpans = trace.spans.filter(s => s.kind === 'node')

  // For each node, sum up its child LLM spans
  const childrenMap = buildSpanTree(trace.spans)

  for (const nodeSpan of nodeSpans) {
    const entry: NodeCost = {
      name: nodeSpan.name,
      kind: nodeSpan.kind,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      llmCalls: 0,
    }

    // Sum direct LLM children
    const llmChildren = (childrenMap.get(nodeSpan.spanId) ?? []).filter(s => s.kind === 'llm')
    for (const llm of llmChildren) {
      if (llm.tokenUsage) {
        entry.totalTokens += llm.tokenUsage.totalTokens
        entry.inputTokens += llm.tokenUsage.inputTokens
        entry.outputTokens += llm.tokenUsage.outputTokens
      }
      if (llm.cost) {
        entry.cost += llm.cost.amount
      }
      entry.llmCalls++
    }

    // Also include node-level aggregated data if present
    if (nodeSpan.tokenUsage) {
      entry.totalTokens += nodeSpan.tokenUsage.totalTokens
      entry.inputTokens += nodeSpan.tokenUsage.inputTokens
      entry.outputTokens += nodeSpan.tokenUsage.outputTokens
    }
    if (nodeSpan.cost) {
      entry.cost += nodeSpan.cost.amount
    }

    nodeMap.set(nodeSpan.spanId, entry)
  }

  // Sort by cost descending
  return Array.from(nodeMap.values()).sort((a, b) => b.cost - a.cost)
}

// ============ Trace display ============

/** Display trace summary header */
function printTraceSummary(trace: Trace): void {
  console.log()
  console.log(chalk.bold(`Trace: ${trace.traceId}`))
  console.log(chalk.gray('─'.repeat(50)))

  const items = [
    ['任务 ID', trace.taskId],
    ['总耗时', trace.totalDurationMs > 0 ? formatDuration(trace.totalDurationMs) : '-'],
    ['Span 数', String(trace.spanCount)],
    ['LLM 调用', String(trace.llmCallCount)],
    ['总 Token', trace.totalTokens > 0 ? trace.totalTokens.toLocaleString() : '-'],
    ['总费用', trace.totalCost > 0 ? `$${trace.totalCost.toFixed(4)}` : '-'],
    ['状态', trace.status === 'error' ? chalk.red(trace.status) : chalk.green(trace.status)],
  ]

  for (const item of items) {
    console.log(chalk.gray(`  ${item[0]!.padEnd(10)}`), item[1])
  }

  console.log()
}

/** Display full span tree */
function printFullTrace(trace: Trace): void {
  printTraceSummary(trace)

  console.log(chalk.bold('调用链路:'))
  console.log()

  const children = buildSpanTree(trace.spans)
  // Find root spans (no parent)
  const rootKey = undefined
  printSpanTree(rootKey, children, '', true, true)
  console.log()
}

/** Display only error spans with their path to root */
function printErrorTrace(trace: Trace): void {
  const errorSpans = trace.spans.filter(s => s.status === 'error')
  if (errorSpans.length === 0) {
    info('无错误 span')
    return
  }

  printTraceSummary(trace)
  console.log(chalk.bold(chalk.red(`错误链路 (${errorSpans.length} 个错误):`)))
  console.log()

  const spanMap = new Map(trace.spans.map(s => [s.spanId, s]))

  for (const errSpan of errorSpans) {
    // Walk up to root
    const chain: Span[] = [errSpan]
    let current = errSpan
    while (current.parentSpanId) {
      const parent = spanMap.get(current.parentSpanId)
      if (!parent) break
      chain.push(parent)
      current = parent
    }
    chain.reverse()

    // Print chain
    for (let i = 0; i < chain.length; i++) {
      const span = chain[i]!
      const indent = '  '.repeat(i)
      const arrow = i > 0 ? '→ ' : ''
      const line = formatSpanLine(span)
      console.log(`${indent}${arrow}${line}`)
    }

    // Print error details
    if (errSpan.error) {
      console.log(chalk.red(`  ${'  '.repeat(chain.length - 1)}  错误: ${errSpan.error.message}`))
      if (errSpan.error.stack) {
        const stackLines = errSpan.error.stack.split('\n').slice(0, 3)
        for (const line of stackLines) {
          console.log(chalk.gray(`  ${'  '.repeat(chain.length - 1)}  ${line}`))
        }
      }
    }
    console.log()
  }
}

/** Display slow spans */
function printSlowSpans(taskId: string, minDurationMs: number): void {
  const slowSpans = querySlowSpans(taskId, { minDurationMs, limit: 20 })
  if (slowSpans.length === 0) {
    info(`无超过 ${formatDuration(minDurationMs)} 的慢 span`)
    return
  }

  console.log()
  console.log(chalk.bold(chalk.yellow(`慢 Span (> ${formatDuration(minDurationMs)}):`)))
  console.log()

  for (const span of slowSpans) {
    const duration = span.durationMs != null ? chalk.yellow(formatDuration(span.durationMs)) : '-'
    const kindTag = chalk.dim(`[${span.kind}]`)
    const status =
      span.status === 'error' ? chalk.red('ERR') : chalk.green('OK ')

    let extra = ''
    if (span.tokenUsage) {
      extra += chalk.cyan(` ${span.tokenUsage.totalTokens}tok`)
    }
    if (span.cost) {
      extra += chalk.yellow(` $${span.cost.amount.toFixed(4)}`)
    }

    console.log(`  ${status} ${kindTag} ${span.name}  ${duration}${extra}`)
  }
  console.log()
}

/** Display cost attribution */
function printCostAttribution(trace: Trace): void {
  const costs = aggregateCosts(trace)
  if (costs.length === 0) {
    info('无成本数据')
    return
  }

  printTraceSummary(trace)
  console.log(chalk.bold('成本归因:'))
  console.log()

  const totalCost = trace.totalCost || costs.reduce((sum, c) => sum + c.cost, 0)

  // Header
  console.log(
    chalk.gray(
      '  ' +
        '节点'.padEnd(30) +
        'LLM调用'.padEnd(10) +
        'Token'.padEnd(12) +
        '费用'.padEnd(12) +
        '占比'
    )
  )
  console.log(chalk.gray('  ' + '─'.repeat(70)))

  for (const entry of costs) {
    const pct = totalCost > 0 ? ((entry.cost / totalCost) * 100).toFixed(1) : '0.0'
    const name = entry.name.length > 28 ? entry.name.slice(0, 25) + '...' : entry.name

    console.log(
      '  ' +
        name.padEnd(30) +
        String(entry.llmCalls).padEnd(10) +
        (entry.totalTokens > 0 ? entry.totalTokens.toLocaleString() : '-').padEnd(12) +
        (entry.cost > 0 ? `$${entry.cost.toFixed(4)}` : '-').padEnd(12) +
        `${pct}%`
    )
  }

  console.log(chalk.gray('  ' + '─'.repeat(70)))
  console.log(
    chalk.bold(
      '  ' +
        '合计'.padEnd(30) +
        String(costs.reduce((s, c) => s + c.llmCalls, 0)).padEnd(10) +
        (trace.totalTokens > 0 ? trace.totalTokens.toLocaleString() : '-').padEnd(12) +
        (totalCost > 0 ? `$${totalCost.toFixed(4)}` : '-').padEnd(12)
    )
  )
  console.log()
}

// ============ Command registration ============

export function registerTraceCommand(taskCmd: Command): void {
  taskCmd
    .command('trace')
    .description('查看任务执行链路追踪')
    .argument('<id>', '任务 ID')
    .option('--slow [ms]', '显示慢 span (默认阈值 1000ms)')
    .option('--errors', '只显示错误链路')
    .option('--cost', '显示成本归因详情')
    .option('--export [format]', '导出为 OTLP JSON 格式')
    .action((id, options) => {
      const task = getTask(id)
      if (!task) {
        error(`任务不存在: ${id}`)
        return
      }

      const traceIds = listTraces(id)
      if (traceIds.length === 0) {
        warn(`任务 ${id} 无追踪数据`)
        info('追踪数据在任务执行时自动记录')
        return
      }

      // --export: export to OTLP JSON
      if (options.export !== undefined) {
        const outPath = typeof options.export === 'string' && options.export !== 'otlp'
          ? options.export
          : undefined
        const filePath = exportTraceToOTLP(id, outPath)
        if (filePath) {
          success(`已导出 OTLP JSON: ${filePath}`)
        } else {
          error('导出失败: 无追踪数据')
        }
        return
      }

      // --slow: show slow spans
      if (options.slow !== undefined) {
        const threshold = typeof options.slow === 'string' ? parseInt(options.slow, 10) : 1000
        printSlowSpans(id, isNaN(threshold) ? 1000 : threshold)
        return
      }

      // Get latest trace (typically traceId === taskId, but handle multiple)
      const traceId = traceIds.includes(id) ? id : traceIds[traceIds.length - 1]!
      const trace = getTrace(id, traceId)
      if (!trace) {
        error('无法读取追踪数据')
        return
      }

      // --errors: show error chains only
      if (options.errors) {
        printErrorTrace(trace)
        return
      }

      // --cost: show cost attribution
      if (options.cost) {
        printCostAttribution(trace)
        return
      }

      // Default: show full trace tree
      printFullTrace(trace)
    })
}
