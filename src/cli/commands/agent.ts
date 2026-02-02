/**
 * Agent 子命令
 * 管理和列出可用的 Agent (Persona)
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { BUILTIN_PERSONAS } from '../../persona/builtinPersonas.js'

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Agent (Persona) 管理')

  agent
    .command('list')
    .description('列出所有可用的 Agent')
    .action(() => {
      console.log()
      console.log(chalk.cyan.bold('  可用 Agent'))
      console.log()

      for (const [name, persona] of Object.entries(BUILTIN_PERSONAS)) {
        if (name === 'None') continue
        console.log(`  ${chalk.green(name.padEnd(14))} ${chalk.gray(persona.description)}`)
      }

      console.log()
      console.log(chalk.dim(`  使用 \`cah "任务" -a <agent>\` 指定 Agent 执行任务`))
      console.log()
    })

  agent
    .command('show')
    .description('查看 Agent 详情')
    .argument('<name>', 'Agent 名称')
    .action((name) => {
      const persona = BUILTIN_PERSONAS[name]
      if (!persona) {
        console.log(chalk.red(`  未找到 Agent: ${name}`))
        console.log(chalk.dim(`  使用 \`cah agent list\` 查看可用 Agent`))
        return
      }

      console.log()
      console.log(chalk.cyan.bold(`  ${persona.name}`))
      console.log(chalk.gray(`  ${persona.description}`))
      console.log()

      if (persona.systemPrompt) {
        console.log(chalk.yellow('  系统提示词:'))
        const lines = persona.systemPrompt.split('\n')
        for (const line of lines) {
          console.log(chalk.dim(`    ${line}`))
        }
        console.log()
      }

      console.log(chalk.yellow('  特性:'))
      console.log(`    代码风格: ${chalk.white(persona.traits.codeStyle)}`)
      console.log(`    注释级别: ${chalk.white(persona.traits.commentLevel)}`)
      console.log(`    错误处理: ${chalk.white(persona.traits.errorHandling)}`)
      console.log(`    命名规范: ${chalk.white(persona.traits.namingConvention)}`)
      console.log()
    })
}
