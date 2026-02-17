import { Command } from 'commander'
import chalk from 'chalk'
import { getAllVersions, getPromptVersion } from '../../store/PromptVersionStore.js'
import {
  rollbackVersion,
  compareVersions,
  createABTest,
  evaluateABTest,
  extractSuccessPatterns,
} from '../../prompt-optimization/index.js'
import { getAllTasks } from '../../store/TaskStore.js'
import { success, error, info, table } from '../output.js'

export function registerPromptCommands(program: Command) {
  const prompt = program.command('prompt').description('Prompt 版本管理')

  prompt
    .command('versions')
    .description('列出 persona 的 prompt 版本')
    .argument('<persona>', 'Persona 名称 (如 Pragmatist)')
    .action(personaName => {
      const versions = getAllVersions(personaName)

      if (versions.length === 0) {
        info(`${personaName} 暂无 prompt 版本`)
        return
      }

      console.log(chalk.bold(`\n${personaName} Prompt 版本 (${versions.length})\n`))

      table(
        versions.map(v => ({
          version: `v${v.version}`,
          id: v.id.slice(0, 12),
          status: v.status,
          rate: v.stats.totalTasks > 0 ? `${(v.stats.successRate * 100).toFixed(0)}%` : '-',
          tasks: String(v.stats.totalTasks),
          created: v.createdAt.slice(0, 10),
        })),
        [
          { key: 'version', header: '版本', width: 6 },
          { key: 'id', header: 'ID', width: 12 },
          { key: 'status', header: '状态', width: 10 },
          { key: 'rate', header: '成功率', width: 6 },
          { key: 'tasks', header: '任务数', width: 6 },
          { key: 'created', header: '创建时间', width: 10 },
        ],
      )

      console.log()
    })

  prompt
    .command('rollback')
    .description('回滚到指定版本')
    .argument('<persona>', 'Persona 名称')
    .argument('<version-id>', '目标版本 ID')
    .action((personaName, versionId) => {
      const result = rollbackVersion(personaName, versionId)
      if (result) {
        success(`已回滚 ${personaName} 到 v${result.version} (${result.id})`)
      } else {
        error(`回滚失败: 版本 ${versionId} 不存在`)
      }
    })

  prompt
    .command('diff')
    .description('对比两个版本的 prompt')
    .argument('<persona>', 'Persona 名称')
    .argument('<v1>', '版本 1 ID')
    .argument('<v2>', '版本 2 ID')
    .action((personaName, v1Id, v2Id) => {
      const v1 = getPromptVersion(personaName, v1Id)
      const v2 = getPromptVersion(personaName, v2Id)

      if (!v1) {
        error(`版本不存在: ${v1Id}`)
        return
      }
      if (!v2) {
        error(`版本不存在: ${v2Id}`)
        return
      }

      console.log(chalk.bold(`\n${personaName} Prompt Diff: v${v1.version} → v${v2.version}\n`))

      console.log(chalk.cyan('--- v' + v1.version + ' (' + v1.id + ')'))
      console.log(chalk.green('+++ v' + v2.version + ' (' + v2.id + ')'))
      console.log()

      // Simple line-by-line diff
      const lines1 = v1.systemPrompt.split('\n')
      const lines2 = v2.systemPrompt.split('\n')
      const maxLines = Math.max(lines1.length, lines2.length)

      for (let i = 0; i < maxLines; i++) {
        const l1 = lines1[i]
        const l2 = lines2[i]

        if (l1 === l2) {
          console.log(chalk.gray(`  ${l1 ?? ''}`))
        } else {
          if (l1 !== undefined) {
            console.log(chalk.red(`- ${l1}`))
          }
          if (l2 !== undefined) {
            console.log(chalk.green(`+ ${l2}`))
          }
        }
      }

      console.log()

      // Show changelogs
      if (v2.changelog) {
        console.log(chalk.yellow(`Changelog (v${v2.version}): ${v2.changelog}`))
      }
      console.log()
    })

  // ============ New Commands ============

  prompt
    .command('compare')
    .description('对比两个版本的效果指标')
    .argument('<persona>', 'Persona 名称')
    .argument('<v1>', '版本 1 ID')
    .argument('<v2>', '版本 2 ID')
    .action((personaName, v1Id, v2Id) => {
      const result = compareVersions(personaName, v1Id, v2Id)

      if (!result) {
        error('版本不存在，请检查 persona 和版本 ID')
        return
      }

      const { version1, version2, diff, recommendation } = result

      console.log(
        chalk.bold(`\n${personaName} 效果对比: v${version1.version} vs v${version2.version}\n`)
      )

      const formatDelta = (delta: number, suffix: string, invertColor = false) => {
        const sign = delta > 0 ? '+' : ''
        const text = `${sign}${delta.toFixed(suffix === '%' ? 1 : 0)}${suffix}`
        const isPositive = invertColor ? delta < 0 : delta > 0
        if (Math.abs(delta) < 0.001) return chalk.gray(text)
        return isPositive ? chalk.green(text) : chalk.red(text)
      }

      table(
        [
          {
            metric: '成功率',
            v1: `${(version1.stats.successRate * 100).toFixed(1)}%`,
            v2: `${(version2.stats.successRate * 100).toFixed(1)}%`,
            delta: formatDelta(diff.successRateDelta * 100, '%'),
          },
          {
            metric: '平均时长',
            v1: `${(version1.stats.avgDurationMs / 1000).toFixed(1)}s`,
            v2: `${(version2.stats.avgDurationMs / 1000).toFixed(1)}s`,
            delta: formatDelta(diff.avgDurationDelta / 1000, 's', true),
          },
          {
            metric: '任务数',
            v1: String(version1.stats.totalTasks),
            v2: String(version2.stats.totalTasks),
            delta: formatDelta(diff.totalTasksDelta, ''),
          },
        ],
        [
          { key: 'metric', header: '指标', width: 10 },
          { key: 'v1', header: `v${version1.version}`, width: 10 },
          { key: 'v2', header: `v${version2.version}`, width: 10 },
          { key: 'delta', header: '变化', width: 12 },
        ],
      )

      console.log()

      const recMap: Record<string, string> = {
        prefer_v1: chalk.green(`推荐保留 v${version1.version}`),
        prefer_v2: chalk.green(`推荐升级到 v${version2.version}`),
        insufficient_data: chalk.yellow('数据不足，无法判断'),
        no_significant_diff: chalk.gray('无显著差异'),
      }
      console.log(`  结论: ${recMap[recommendation] ?? recommendation}`)
      console.log()
    })

  prompt
    .command('test')
    .description('对 persona 启动 A/B 测试')
    .argument('<persona>', 'Persona 名称')
    .option('-s, --min-samples <n>', '最小样本数', '5')
    .action((personaName, opts) => {
      const versions = getAllVersions(personaName)
      const candidate = versions.find(v => v.status === 'candidate')

      if (!candidate) {
        error(`${personaName} 没有 candidate 版本。请先生成改进版 prompt`)
        return
      }

      try {
        const test = createABTest(personaName, candidate.id, parseInt(opts.minSamples, 10))
        success(`A/B 测试已创建`)
        console.log()
        console.log(`  测试 ID:   ${chalk.cyan(test.id)}`)
        console.log(`  Control:   ${chalk.gray(test.controlVersionId.slice(0, 12))} (active)`)
        console.log(`  Candidate: ${chalk.yellow(candidate.id.slice(0, 12))} (v${candidate.version})`)
        console.log(`  最小样本:  ${test.minSamples}`)
        console.log()
      } catch (e) {
        error(`创建 A/B 测试失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })

  prompt
    .command('evaluate')
    .description('评估 A/B 测试结果')
    .argument('<test-id>', 'A/B 测试 ID')
    .action(testId => {
      const result = evaluateABTest(testId)

      if (!result) {
        info('测试数据不足或测试不存在。需要更多样本才能得出结论')
        return
      }

      console.log(chalk.bold('\nA/B 测试评估结果\n'))

      table(
        [
          {
            variant: 'Control',
            tasks: String(result.controlStats.totalTasks),
            rate: `${(result.controlStats.successRate * 100).toFixed(1)}%`,
            duration: `${(result.controlStats.avgDurationMs / 1000).toFixed(1)}s`,
            fitness: result.fitnessControl.toFixed(3),
          },
          {
            variant: 'Candidate',
            tasks: String(result.candidateStats.totalTasks),
            rate: `${(result.candidateStats.successRate * 100).toFixed(1)}%`,
            duration: `${(result.candidateStats.avgDurationMs / 1000).toFixed(1)}s`,
            fitness: result.fitnessCandidate.toFixed(3),
          },
        ],
        [
          { key: 'variant', header: '版本', width: 10 },
          { key: 'tasks', header: '任务数', width: 6 },
          { key: 'rate', header: '成功率', width: 8 },
          { key: 'duration', header: '平均时长', width: 8 },
          { key: 'fitness', header: 'Fitness', width: 8 },
        ],
      )

      console.log()

      const winnerColors: Record<string, (s: string) => string> = {
        candidate: chalk.green,
        control: chalk.blue,
        inconclusive: chalk.yellow,
      }
      const colorFn = winnerColors[result.winner] ?? chalk.white
      console.log(`  Winner: ${colorFn(result.winner)}`)
      console.log(`  ${result.recommendation}`)
      console.log()
    })

  prompt
    .command('extract')
    .description('从成功任务提取 workflow 模式')
    .option('-l, --limit <n>', '最大模式数', '20')
    .action(opts => {
      const tasks = getAllTasks()
      const completedTasks = tasks.filter(t => t.status === 'completed')

      if (completedTasks.length === 0) {
        info('没有已完成的任务，无法提取模式')
        return
      }

      const patterns = extractSuccessPatterns(completedTasks, parseInt(opts.limit, 10))

      if (patterns.length === 0) {
        info('未找到可提取的 workflow 模式')
        return
      }

      console.log(chalk.bold(`\n成功模式 (${patterns.length} 个)\n`))

      table(
        patterns.map(p => ({
          type: p.taskType,
          nodes: p.nodeSequence.join(' → '),
          samples: String(p.sampleCount),
          duration: `${(p.avgDuration / 1000).toFixed(1)}s`,
          confidence: `${(p.confidence * 100).toFixed(0)}%`,
        })),
        [
          { key: 'type', header: '类型', width: 12 },
          { key: 'nodes', header: '节点序列', width: 40 },
          { key: 'samples', header: '样本数', width: 6 },
          { key: 'duration', header: '平均时长', width: 10 },
          { key: 'confidence', header: '置信度', width: 8 },
        ],
      )

      console.log()
    })
}
