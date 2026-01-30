import { Command } from 'commander'
import { initProject } from '../../config/initProject.js'

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('初始化项目配置')
    .option('-f, --force', '强制覆盖已有配置')
    .action(async (options) => {
      await initProject(options)
    })
}
