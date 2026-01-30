import { Command } from 'commander'
import { generateReport } from '../../report/generateReport.js'
import { approvePR } from '../../git/approvePR.js'
import { rejectPR } from '../../git/rejectPR.js'

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

  program
    .command('approve')
    .description('审批 PR')
    .argument('<branch>', '分支名称')
    .option('-m, --message <msg>', '审批备注')
    .action(async (branch, options) => {
      await approvePR(branch, options)
    })

  program
    .command('reject')
    .description('拒绝 PR')
    .argument('<branch>', '分支名称')
    .option('-m, --message <msg>', '拒绝原因')
    .action(async (branch, options) => {
      await rejectPR(branch, options)
    })
}
