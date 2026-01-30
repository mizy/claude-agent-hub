import { Command } from 'commander'
import chalk from 'chalk'
import { createAgent } from '../../agent/createAgent.js'
import { listAgents } from '../../agent/listAgents.js'
import { getAgentStatus } from '../../agent/getAgentStatus.js'
import { runAgent } from '../../agent/runAgent.js'
import { getStore } from '../../store/index.js'
import { success, error, info } from '../output.js'

export function registerAgentCommands(program: Command) {
  const agent = program
    .command('agent')
    .description('Agent 管理命令')

  agent
    .command('create')
    .description('创建新 Agent')
    .requiredOption('-n, --name <name>', 'Agent 名称')
    .option('-p, --persona <persona>', '人格模板', 'Pragmatist')
    .option('-d, --description <desc>', 'Agent 描述')
    .action(async (options) => {
      await createAgent(options)
    })

  agent
    .command('list')
    .description('列出所有 Agent')
    .action(async () => {
      await listAgents()
    })

  agent
    .command('status')
    .description('查看 Agent 状态')
    .argument('[name]', 'Agent 名称，不指定则显示全部')
    .action(async (name) => {
      await getAgentStatus(name)
    })

  agent
    .command('run')
    .description('手动运行 Agent 执行一次任务')
    .argument('<name>', 'Agent 名称')
    .action(async (name) => {
      const store = getStore()
      const agentObj = store.getAgent(name)

      if (!agentObj) {
        error(`Agent not found: ${name}`)
        console.log(chalk.gray('Use `cah agent list` to see available agents'))
        return
      }

      if (agentObj.status === 'working') {
        error(`Agent ${name} is already working`)
        return
      }

      info(`Running agent: ${name}`)
      try {
        await runAgent(name)
        success('Agent run completed')
      } catch (err) {
        error(`Agent run failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}
