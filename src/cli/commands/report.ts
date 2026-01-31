import { Command } from 'commander'
import { generateReport } from '../../report/generateReport.js'

export function registerReportCommands(program: Command) {
  program
    .command('report')
    .description('生成工作报告')
    .option('-a, --agent <name>', '指定 Agent')
    .option('-d, --days <days>', '报告天数', '1')
    .option('-o, --output <file>', '输出到文件')
    .action(async (options) => {
      await generateReport(options)
    })
}
