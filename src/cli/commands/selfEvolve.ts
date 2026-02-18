/**
 * self evolve 子命令 — 自我进化管理
 *
 * cah self evolve           → 运行一轮完整进化（失败分析 + 性能分析 + agent review）
 * cah self evolve analyze   → 分析任务效率（耗时/成本/性能模式）
 * cah self evolve validate <id> → 验证进化效果
 * cah self evolve history   → 查看进化历史（含 review 信息）
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { getErrorMessage } from '../../shared/assertError.js'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

export function registerSelfEvolveCommand(parent: Command) {
  const evolve = parent
    .command('evolve')
    .description('自我进化管理')
    .action(async () => {
      // Default: run a full evolution cycle
      console.log()
      console.log(chalk.bold('🧬 自我进化'))
      console.log()

      try {
        const { runEvolutionCycle } = await import('../../selfevolve/index.js')
        const { evolutionId, record } = await runEvolutionCycle({ trigger: 'manual' })

        const statusIcon = record.status === 'completed' ? '✅' : '❌'
        console.log(`${statusIcon} 进化周期: ${evolutionId}`)
        console.log(`  失败模式: ${record.patterns.length} 个`)
        console.log(`  改进方案: ${record.improvements.length} 个`)

        // Performance analysis summary
        if (record.performanceAnalysis) {
          const pa = record.performanceAnalysis
          console.log()
          console.log(chalk.bold('  📊 性能分析:'))
          console.log(`    平均耗时: ${formatDuration(pa.avgDurationMs)}`)
          console.log(`    平均成本: $${pa.avgCostUsd.toFixed(4)}`)
          console.log(`    成功率: ${(pa.successRate * 100).toFixed(0)}%`)
          if (pa.patterns.length > 0) {
            console.log(`    性能问题: ${pa.patterns.length} 个`)
          }
        }

        // Review results summary
        if (record.reviewResults && record.reviewResults.length > 0) {
          const approved = record.reviewResults.filter(r => r.review.approved).length
          const rejected = record.reviewResults.length - approved
          console.log()
          console.log(chalk.bold('  🔍 Agent Review:'))
          console.log(`    通过: ${chalk.green(String(approved))}  拒绝: ${chalk.red(String(rejected))}`)
        }

        if (record.error) {
          console.log(chalk.red(`  错误: ${record.error}`))
        }

        if (record.patterns.length === 0 && (!record.performanceAnalysis || record.performanceAnalysis.patterns.length === 0)) {
          console.log(chalk.green('  没有发现问题，系统运行良好'))
        }
      } catch (err) {
        console.log(chalk.red(`进化失败: ${getErrorMessage(err)}`))
        process.exit(1)
      }

      console.log()
    })

  evolve
    .command('analyze')
    .description('分析任务效率（失败模式 + 性能分析）')
    .option('-n, --limit <n>', '分析数量上限', '50')
    .action(async (options: { limit: string }) => {
      console.log()
      console.log(chalk.bold('🔍 效率分析'))
      console.log()

      const limit = parseInt(options.limit, 10)

      try {
        // Failure analysis
        const { analyzeTaskPatterns, analyzePerformance } = await import('../../selfevolve/index.js')
        const failureResult = analyzeTaskPatterns({ limit })

        if (failureResult.patterns.length > 0) {
          console.log(chalk.bold('失败模式:'))
          for (const pattern of failureResult.patterns) {
            console.log(
              `  ${chalk.red('•')} [${pattern.category}] ${pattern.description} (${pattern.occurrences} 次)`
            )
          }
          console.log()
        }

        if (Object.keys(failureResult.personaBreakdown).length > 0) {
          console.log(chalk.bold('Persona 分布:'))
          for (const [persona, stats] of Object.entries(failureResult.personaBreakdown)) {
            const parts = []
            if (stats.successes) parts.push(`${stats.successes} 成功`)
            if (stats.failures) parts.push(`${stats.failures} 失败`)
            console.log(`  ${persona}: ${parts.join(', ')} (主要: ${stats.topCategory})`)
          }
          console.log()
        }

        // Performance analysis
        const perfResult = analyzePerformance({ limit, includeCompleted: true, includeFailed: true })

        console.log(chalk.bold('📊 性能概览:'))
        console.log(`  分析任务数: ${perfResult.totalExamined}`)
        console.log(`  平均耗时: ${formatDuration(perfResult.avgDurationMs)}`)
        console.log(`  平均成本: $${perfResult.avgCostUsd.toFixed(4)}`)
        console.log(`  成功率: ${(perfResult.successRate * 100).toFixed(0)}%`)

        if (perfResult.patterns.length > 0) {
          console.log()
          console.log(chalk.bold('性能问题:'))
          for (const pattern of perfResult.patterns) {
            const severityColor =
              pattern.severity === 'critical' ? chalk.red :
              pattern.severity === 'warning' ? chalk.yellow : chalk.gray
            console.log(`  ${severityColor('•')} [${pattern.category}] ${pattern.description}`)
            console.log(chalk.gray(`    建议: ${pattern.suggestion}`))
          }
        }

        if (perfResult.nodeHotspots.length > 0) {
          console.log()
          console.log(chalk.bold('节点耗时排名 (Top 5):'))
          for (const hotspot of perfResult.nodeHotspots.slice(0, 5)) {
            console.log(
              `  ${hotspot.nodeName}: ${formatDuration(hotspot.avgDurationMs)} (${hotspot.occurrences} 次)`
            )
          }
        }

        if (failureResult.patterns.length === 0 && perfResult.patterns.length === 0) {
          console.log()
          console.log(chalk.green('没有发现问题，系统运行良好 ✅'))
        }
      } catch (err) {
        console.log(chalk.red(`分析失败: ${getErrorMessage(err)}`))
        process.exit(1)
      }

      console.log()
    })

  evolve
    .command('validate')
    .description('验证进化效果')
    .argument('<id>', '进化 ID')
    .action(async (id: string) => {
      console.log()
      console.log(chalk.bold('📊 进化验证'))
      console.log()

      try {
        const { validateEvolution } = await import('../../selfevolve/index.js')
        const validation = validateEvolution(id)

        if (!validation) {
          console.log(chalk.red(`未找到进化记录: ${id}`))
          process.exit(1)
          return
        }

        const icon = validation.improved ? chalk.green('✓ 已改善') : chalk.yellow('✗ 未改善')
        console.log(`${icon}`)
        console.log(
          `  成功率: ${(validation.baselineSuccessRate * 100).toFixed(0)}% → ${(validation.currentSuccessRate * 100).toFixed(0)}%`
        )
        console.log(`  样本量: ${validation.sampleSize}`)

        if (validation.performanceTrend) {
          const pt = validation.performanceTrend
          const dIcon = pt.durationImproved ? chalk.green('↓') : chalk.red('↑')
          const cIcon = pt.costImproved ? chalk.green('↓') : chalk.red('↑')
          console.log(`  耗时: ${formatDuration(pt.avgDurationBefore)} → ${formatDuration(pt.avgDurationAfter)} ${dIcon}`)
          console.log(`  成本: $${pt.avgCostBefore.toFixed(4)} → $${pt.avgCostAfter.toFixed(4)} ${cIcon}`)
        }

        console.log(`  ${validation.summary}`)
      } catch (err) {
        console.log(chalk.red(`验证失败: ${getErrorMessage(err)}`))
        process.exit(1)
      }

      console.log()
    })

  evolve
    .command('history')
    .description('查看进化历史')
    .option('-n, --limit <n>', '显示数量', '10')
    .action(async (options: { limit: string }) => {
      console.log()
      console.log(chalk.bold('📜 进化历史'))
      console.log()

      try {
        const { listEvolutions } = await import('../../selfevolve/index.js')
        const evolutions = listEvolutions()
        const limit = parseInt(options.limit, 10)
        const display = evolutions.slice(0, limit)

        if (display.length === 0) {
          console.log(chalk.gray('  暂无进化记录'))
          console.log(chalk.gray('  执行 cah self evolve 启动一轮进化'))
        } else {
          for (const evo of display) {
            const statusIcon =
              evo.status === 'completed' ? '✅' :
              evo.status === 'failed' ? '❌' : '⏳'
            const date = new Date(evo.startedAt).toLocaleString()
            console.log(
              `${statusIcon} ${evo.id}  ${chalk.gray(date)}  ${evo.trigger}`
            )

            // Build summary parts
            const parts = [`${evo.patterns.length} 模式`, `${evo.improvements.length} 改进`]

            if (evo.reviewResults && evo.reviewResults.length > 0) {
              const approved = evo.reviewResults.filter(r => r.review.approved).length
              parts.push(`review ${approved}/${evo.reviewResults.length} 通过`)
            }

            if (evo.performanceAnalysis) {
              parts.push(`耗时 ${formatDuration(evo.performanceAnalysis.avgDurationMs)}`)
            }

            console.log(chalk.gray(`   ${parts.join(', ')}`))
          }

          if (evolutions.length > limit) {
            console.log(chalk.gray(`\n  共 ${evolutions.length} 条，显示最近 ${limit} 条`))
          }
        }
      } catch (err) {
        console.log(chalk.red(`查询失败: ${getErrorMessage(err)}`))
      }

      console.log()
    })
}
