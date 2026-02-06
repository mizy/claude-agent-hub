import { Command } from 'commander'
import { writeFileSync } from 'fs'
import { generateReport } from '../../report/generateReport.js'
import {
  generateTrendReport,
  formatTrendReportForTerminal,
  formatTrendReportForMarkdown,
} from '../../report/TrendAnalyzer.js'
import {
  generateLiveSummary,
  formatLiveSummaryForTerminal,
  formatLiveSummaryForJson,
} from '../../report/LiveSummary.js'
import { success, warn } from '../output.js'

export function registerReportCommands(program: Command) {
  const report = program
    .command('report')
    .description('报告命令')

  // 原有的工作报告
  report
    .command('work')
    .description('生成工作报告')
    .option('-a, --agent <name>', '指定 Agent')
    .option('-d, --days <days>', '报告天数', '1')
    .option('-o, --output <file>', '输出到文件')
    .action(async (options) => {
      await generateReport(options)
    })

  // 趋势分析报告
  report
    .command('trend')
    .description('生成趋势分析报告')
    .option('-d, --days <days>', '分析天数', '30')
    .option('-p, --period <period>', '周期类型 (day/week/month)', 'week')
    .option('--markdown', '输出 Markdown 格式')
    .option('--json', '输出 JSON 格式')
    .option('-o, --output <file>', '保存到文件')
    .action((options) => {
      const days = parseInt(options.days, 10)
      const period = options.period as 'day' | 'week' | 'month'

      const trendReport = generateTrendReport(days, period)

      if (!trendReport) {
        warn('没有足够的执行数据生成趋势报告')
        console.log('  提示: 执行一些任务后再来查看趋势')
        return
      }

      let output: string
      if (options.json) {
        output = JSON.stringify(trendReport, null, 2)
      } else if (options.markdown) {
        output = formatTrendReportForMarkdown(trendReport)
      } else {
        output = formatTrendReportForTerminal(trendReport)
      }

      if (options.output) {
        writeFileSync(options.output, output)
        success(`报告已保存到: ${options.output}`)
      } else {
        console.log(output)
      }
    })

  // 实时摘要
  report
    .command('live')
    .alias('status')
    .description('显示实时任务状态和今日统计')
    .option('--json', '输出 JSON 格式')
    .option('-w, --watch', '持续监控模式')
    .option('-i, --interval <ms>', '刷新间隔 (毫秒)', '3000')
    .action(async (options) => {
      const showLive = () => {
        const liveReport = generateLiveSummary()

        if (options.json) {
          console.log(formatLiveSummaryForJson(liveReport))
        } else {
          // 清屏 (watch 模式)
          if (options.watch) {
            console.clear()
          }
          console.log(formatLiveSummaryForTerminal(liveReport))
        }
      }

      showLive()

      if (options.watch) {
        const interval = parseInt(options.interval, 10)
        setInterval(showLive, interval)

        // 等待 Ctrl+C
        process.on('SIGINT', () => {
          console.log('\n')
          process.exit(0)
        })

        // 阻止程序退出
        await new Promise(() => {})
      }
    })

}
