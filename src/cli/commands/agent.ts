/**
 * Agent 子命令
 * 管理和列出可用的 Agent
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { BUILTIN_AGENTS } from '../../agents/builtinAgents.js'

export function registerAgentCommands(program: Command): void {
  const agent = program.command('agent').description('Agent 管理')

  agent
    .command('list')
    .description('列出所有可用的 Agent')
    .action(() => {
      console.log()
      console.log(chalk.cyan.bold('  可用 Agent'))
      console.log()

      for (const [name, agentConfig] of Object.entries(BUILTIN_AGENTS)) {
        if (name === 'None') continue
        console.log(`  ${chalk.green(name.padEnd(14))} ${chalk.gray(agentConfig.description)}`)
      }

      console.log()
      console.log(chalk.dim(`  使用 \`cah "任务" -a <agent>\` 指定 Agent 执行任务`))
      console.log()
    })

  agent
    .command('show')
    .description('查看 Agent 详情')
    .argument('<name>', 'Agent 名称')
    .action(name => {
      const agentConfig = BUILTIN_AGENTS[name]
      if (!agentConfig) {
        console.log(chalk.red(`  未找到 Agent: ${name}`))
        console.log(chalk.dim(`  使用 \`cah agent list\` 查看可用 Agent`))
        return
      }

      console.log()
      console.log(chalk.cyan.bold(`  ${agentConfig.name}`))
      console.log(chalk.gray(`  ${agentConfig.description}`))
      console.log()

      if (agentConfig.systemPrompt) {
        console.log(chalk.yellow('  系统提示词:'))
        const lines = agentConfig.systemPrompt.split('\n')
        for (const line of lines) {
          console.log(chalk.dim(`    ${line}`))
        }
        console.log()
      }

      console.log(chalk.yellow('  特性:'))
      console.log(`    代码风格: ${chalk.white(agentConfig.traits.codeStyle)}`)
      console.log(`    注释级别: ${chalk.white(agentConfig.traits.commentLevel)}`)
      console.log(`    错误处理: ${chalk.white(agentConfig.traits.errorHandling)}`)
      console.log(`    命名规范: ${chalk.white(agentConfig.traits.namingConvention)}`)
      console.log()
    })
}
