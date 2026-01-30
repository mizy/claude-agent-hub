import { Command } from 'commander'
import { createAgent } from '../../agent/createAgent.js'
import { listAgents } from '../../agent/listAgents.js'
import { getAgentStatus } from '../../agent/getAgentStatus.js'

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
}
