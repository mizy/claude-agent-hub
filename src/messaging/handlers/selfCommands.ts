/**
 * Self management commands — /self check, /self evolve, /self drive, /self status
 */

import { getErrorMessage } from '../../shared/assertError.js'
import { getAllTasks } from '../../store/TaskStore.js'
import {
  buildCard,
  mdElement,
  hrElement,
  noteElement,
} from '../buildLarkCard.js'
import { statusEmoji } from './constants.js'
import type { CommandResult } from './types.js'

/**
 * Route /self subcommands
 */
export async function handleSelf(args: string): Promise<CommandResult> {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'status'
  const rest = parts.slice(1).join(' ')

  switch (sub) {
    case 'check':
      return handleSelfCheck()
    case 'evolve':
      return handleSelfEvolve(rest)
    case 'drive':
      return handleSelfDrive(rest)
    case 'status':
      return handleSelfStatus()
    default:
      return {
        text: [
          '用法: /self <子命令>',
          '',
          '  check    — 健康检查',
          '  evolve   — 自我进化（失败分析+性能分析+review）',
          '  evolve analyze — 效率分析（失败模式+性能）',
          '  evolve history — 进化历史',
          '  drive start  — 启动自驱',
          '  drive stop   — 停止自驱',
          '  drive status — 自驱状态',
          '  status   — 综合状态',
        ].join('\n'),
      }
  }
}

async function handleSelfCheck(): Promise<CommandResult> {
  try {
    const { runHealthCheck } = await import('../../selfevolve/index.js')
    const result = await runHealthCheck({ autoFix: true })

    if (result.signals.length === 0) {
      return {
        text: '🔍 信号检测\n\n✅ 未检测到异常信号',
        larkCard: buildCard('🔍 信号检测', 'green', [
          mdElement('✅ 未检测到异常信号'),
        ]),
      }
    }

    const SEVERITY_ICON: Record<string, string> = {
      critical: '❌',
      warning: '⚠️',
      info: 'ℹ️',
    }

    const signalLines = result.signals.map(s => {
      const icon = SEVERITY_ICON[s.severity] ?? '?'
      return `${icon} **${s.type}** (${s.severity})`
    })

    const elements = [mdElement(signalLines.join('\n'))]

    if (result.repairs.length > 0) {
      elements.push(hrElement())
      const repairLines = result.repairs.map(r => `✅ [${r.signal.type}] ${r.result}`)
      elements.push(mdElement(`**自动修复**\n${repairLines.join('\n')}`))
    }

    const hasCritical = result.signals.some(s => s.severity === 'critical')
    const headerColor = hasCritical ? 'red' : 'orange'

    return {
      text: `🔍 信号检测\n\n${signalLines.join('\n')}`,
      larkCard: buildCard('🔍 信号检测', headerColor, elements),
    }
  } catch (err) {
    return { text: `❌ 信号检测失败: ${getErrorMessage(err)}` }
  }
}

async function handleSelfEvolve(args: string): Promise<CommandResult> {
  const sub = args.trim().split(/\s+/)[0] || ''

  if (sub === 'analyze') {
    try {
      const { analyzeTaskPatterns, analyzePerformance } = await import('../../selfevolve/index.js')
      const failureResult = analyzeTaskPatterns({ limit: 50 })
      const perfResult = analyzePerformance({ limit: 50, includeCompleted: true, includeFailed: true })

      const sections: string[] = []

      // Failure patterns
      if (failureResult.patterns.length > 0) {
        const patternLines = failureResult.patterns.map(
          p => `**[${p.category}]** ${p.description} (${p.occurrences} 次)`
        )
        sections.push(`**失败模式**\n${patternLines.join('\n')}`)
      }

      // Performance overview
      const fmtDur = (ms: number) => ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}min`
      sections.push(
        `**性能概览**\n` +
        `分析任务: ${perfResult.totalExamined}\n` +
        `平均耗时: ${fmtDur(perfResult.avgDurationMs)}\n` +
        `平均成本: $${perfResult.avgCostUsd.toFixed(4)}\n` +
        `成功率: ${(perfResult.successRate * 100).toFixed(0)}%`
      )

      // Performance issues
      if (perfResult.patterns.length > 0) {
        const issueLines = perfResult.patterns.map(
          p => `⚠️ [${p.category}] ${p.description}`
        )
        sections.push(`**性能问题**\n${issueLines.join('\n')}`)
      }

      // Node hotspots
      if (perfResult.nodeHotspots.length > 0) {
        const hotLines = perfResult.nodeHotspots.slice(0, 5).map(
          h => `${h.nodeName}: ${fmtDur(h.avgDurationMs)} (${h.occurrences}次)`
        )
        sections.push(`**节点耗时 Top 5**\n${hotLines.join('\n')}`)
      }

      const noIssues = failureResult.patterns.length === 0 && perfResult.patterns.length === 0
      const headerColor = noIssues ? 'green' : 'blue'

      if (noIssues) {
        sections.push('没有发现问题，系统运行良好 ✅')
      }

      const elements = sections.map(s => mdElement(s))
      // Add hr between sections
      const withHr: ReturnType<typeof mdElement>[] = []
      for (const [i, el] of elements.entries()) {
        if (i > 0) withHr.push(hrElement())
        withHr.push(el)
      }

      return {
        text: `🔍 效率分析\n\n${sections.join('\n\n')}`,
        larkCard: buildCard('🔍 效率分析', headerColor, withHr),
      }
    } catch (err) {
      return { text: `❌ 分析失败: ${getErrorMessage(err)}` }
    }
  }

  if (sub === 'history') {
    try {
      const { listEvolutions } = await import('../../selfevolve/index.js')
      const evolutions = listEvolutions().slice(0, 10)

      if (evolutions.length === 0) {
        return { text: '📜 进化历史: 暂无记录\n\n使用 /self evolve 启动一轮进化' }
      }

      const lines = evolutions.map(evo => {
        const icon = evo.status === 'completed' ? '✅' : evo.status === 'failed' ? '❌' : '⏳'
        const date = new Date(evo.startedAt).toLocaleString()
        const parts = [`${evo.patterns.length} 模式`, `${evo.improvements.length} 改进`]

        if (evo.reviewResults && evo.reviewResults.length > 0) {
          const approved = evo.reviewResults.filter(r => r.review.approved).length
          parts.push(`review ${approved}/${evo.reviewResults.length} 通过`)
        }

        return `${icon} ${evo.id} — ${parts.join(', ')} (${date})`
      })

      return {
        text: `📜 进化历史\n\n${lines.join('\n')}`,
        larkCard: buildCard('📜 进化历史', 'blue', [
          mdElement(lines.join('\n')),
        ]),
      }
    } catch (err) {
      return { text: `❌ 查询失败: ${getErrorMessage(err)}` }
    }
  }

  // Default: run evolution cycle
  try {
    const { runEvolutionCycle } = await import('../../selfevolve/index.js')
    const { evolutionId, record } = await runEvolutionCycle({ trigger: 'manual' })

    const icon = record.status === 'completed' ? '✅' : '❌'
    const summaryParts = [
      `${icon} 进化周期 ${evolutionId}`,
      `失败模式: ${record.patterns.length} | 改进: ${record.improvements.length}`,
    ]

    const elements = [mdElement(summaryParts.join('\n'))]

    // Performance analysis
    if (record.performanceAnalysis) {
      const pa = record.performanceAnalysis
      const fmtDur = (ms: number) => ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}min`
      elements.push(hrElement())
      elements.push(mdElement(
        `**性能分析**\n` +
        `平均耗时: ${fmtDur(pa.avgDurationMs)} | 成本: $${pa.avgCostUsd.toFixed(4)} | 成功率: ${(pa.successRate * 100).toFixed(0)}%` +
        (pa.patterns.length > 0 ? `\n性能问题: ${pa.patterns.length} 个` : '')
      ))
    }

    // Review results
    if (record.reviewResults && record.reviewResults.length > 0) {
      const approved = record.reviewResults.filter(r => r.review.approved).length
      const rejected = record.reviewResults.length - approved
      elements.push(hrElement())
      elements.push(mdElement(
        `**Agent Review**\n` +
        `<font color="green">通过: ${approved}</font>  <font color="red">拒绝: ${rejected}</font>`
      ))
    }

    if (record.error) {
      elements.push(mdElement(`**错误**: ${record.error}`))
    } else {
      elements.push(noteElement('进化周期已完成'))
    }

    const textSummary = summaryParts.join('\n')
    return {
      text: `🧬 自我进化\n\n${textSummary}${record.error ? `\n错误: ${record.error}` : ''}`,
      larkCard: buildCard('🧬 自我进化', record.status === 'completed' ? 'green' : 'red', elements),
    }
  } catch (err) {
    return { text: `❌ 进化失败: ${getErrorMessage(err)}` }
  }
}

async function handleSelfDrive(args: string): Promise<CommandResult> {
  const sub = args.trim().split(/\s+/)[0] || 'status'

  if (sub === 'start') {
    try {
      const { startSelfDrive, getSelfDriveStatus } = await import('../../selfdrive/index.js')
      startSelfDrive()
      const status = getSelfDriveStatus()

      return {
        text: `✅ 自驱模式已启动\n活跃目标: ${status.scheduler.activeGoals}`,
        larkCard: buildCard('🚗 自驱模式', 'green', [
          mdElement(`✅ **自驱模式已启动**\n\n活跃目标: ${status.scheduler.activeGoals}`),
          noteElement('目标将按计划自动执行'),
        ]),
      }
    } catch (err) {
      return { text: `❌ 启动失败: ${getErrorMessage(err)}` }
    }
  }

  if (sub === 'stop') {
    try {
      const { stopSelfDrive } = await import('../../selfdrive/index.js')
      stopSelfDrive()

      return {
        text: '⏹ 自驱模式已停止',
        larkCard: buildCard('🚗 自驱模式', 'grey', [
          mdElement('⏹ **自驱模式已停止**\n\n目标保留，可随时重新启动'),
        ]),
      }
    } catch (err) {
      return { text: `❌ 停止失败: ${getErrorMessage(err)}` }
    }
  }

  // Default: status
  try {
    const { getSelfDriveStatus, listGoals } = await import('../../selfdrive/index.js')
    const status = getSelfDriveStatus()
    const goals = listGoals()

    const statusIcon = status.enabled ? '✅ 启用' : '⏹ 停用'
    const goalLines = goals.map(g => {
      const icon = g.enabled ? '●' : '○'
      const result = g.lastResult === 'success' ? '✅' : g.lastResult === 'failure' ? '❌' : '—'
      return `${icon} ${g.type} (${g.schedule}) ${result}`
    })

    // Recent selfdrive tasks
    const selfdriveTasks = getAllTasks()
      .filter(t => t.source === 'selfdrive')
      .slice(0, 5)

    const taskLines = selfdriveTasks.map(t => {
      const shortId = t.id.replace(/^task-/, '').slice(0, 4)
      return `${statusEmoji(t.status)} ${shortId} ${t.title}`
    })

    const textParts = [
      `🚗 自驱状态: ${statusIcon}`,
      `调度器: ${status.scheduler.running ? '运行中' : '停止'}`,
      '',
      ...goalLines,
    ]
    if (taskLines.length > 0) {
      textParts.push('', '最近任务:', ...taskLines)
    }

    const cardElements = [
      mdElement(`**状态**: ${statusIcon}\n**调度器**: ${status.scheduler.running ? '运行中' : '停止'}`),
      hrElement(),
      mdElement(goalLines.length > 0 ? goalLines.join('\n') : '暂无目标'),
    ]
    if (taskLines.length > 0) {
      cardElements.push(hrElement())
      cardElements.push(mdElement(`**最近任务**\n${taskLines.join('\n')}`))
    }

    return {
      text: textParts.join('\n'),
      larkCard: buildCard('🚗 自驱状态', status.enabled ? 'green' : 'grey', cardElements),
    }
  } catch (err) {
    return { text: `❌ 查询失败: ${getErrorMessage(err)}` }
  }
}

async function handleSelfStatus(): Promise<CommandResult> {
  const lines: string[] = ['🤖 Self 综合状态', '']

  // 1. Signal detection
  try {
    const { detectSignals } = await import('../../selfevolve/index.js')
    const signals = detectSignals()
    if (signals.length === 0) {
      lines.push('**健康**: ✅ 无异常信号')
    } else {
      const critical = signals.filter(s => s.severity === 'critical').length
      const icon = critical > 0 ? '❌' : '⚠️'
      lines.push(`**健康**: ${icon} ${signals.length} 个信号`)
    }
  } catch {
    lines.push('**健康**: ❓ 检测失败')
  }

  // 2. Evolution
  try {
    const { getLatestEvolution, listEvolutions } = await import('../../selfevolve/index.js')
    const total = listEvolutions().length
    const latest = getLatestEvolution()
    if (latest) {
      const icon = latest.status === 'completed' ? '✅' : '❌'
      let evoSummary = `${icon} 共 ${total} 次 | 最近: ${latest.patterns.length} 模式`
      if (latest.reviewResults && latest.reviewResults.length > 0) {
        const approved = latest.reviewResults.filter(r => r.review.approved).length
        evoSummary += ` | review ${approved}/${latest.reviewResults.length}`
      }
      lines.push(`**进化**: ${evoSummary}`)
    } else {
      lines.push('**进化**: 暂无记录')
    }
  } catch {
    lines.push('**进化**: 未初始化')
  }

  // 3. Self-drive
  try {
    const { getSelfDriveStatus, listGoals } = await import('../../selfdrive/index.js')
    const status = getSelfDriveStatus()
    const goals = listGoals()
    const enabled = goals.filter(g => g.enabled).length
    const driveIcon = status.enabled ? '✅' : '⏹'
    lines.push(`**自驱**: ${driveIcon} ${enabled}/${goals.length} 目标启用`)
  } catch {
    lines.push('**自驱**: 未初始化')
  }

  const cardElements = [mdElement(lines.slice(2).join('\n'))]
  cardElements.push(noteElement('使用 /self check, /self evolve, /self drive 查看详情'))

  return {
    text: lines.join('\n'),
    larkCard: buildCard('🤖 Self 综合状态', 'blue', cardElements),
  }
}
