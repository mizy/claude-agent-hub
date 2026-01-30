import chalk from 'chalk'
import { table } from 'table'
import { getStore } from '../store/index.js'

export async function listAgents(): Promise<void> {
  const store = getStore()
  const agents = store.getAllAgents()

  if (agents.length === 0) {
    console.log(chalk.yellow('暂无 Agent，使用 `cah agent create` 创建'))
    return
  }

  const data = [
    ['名称', '人格', '状态', '完成任务', '创建时间']
  ]

  for (const agent of agents) {
    const statusColor = {
      idle: chalk.gray,
      working: chalk.blue,
      waiting: chalk.yellow
    }[agent.status] || chalk.white

    data.push([
      agent.name,
      agent.persona,
      statusColor(agent.status),
      String(agent.stats.tasksCompleted),
      agent.createdAt.split('T')[0] ?? ''
    ])
  }

  console.log(table(data))
}
