import chalk from 'chalk'
import { getStore } from '../store/index.js'
import type { Agent } from '../types/agent.js'

export async function getAgentStatus(name?: string): Promise<void> {
  const store = getStore()

  if (name) {
    const agent = store.getAgent(name)
    if (!agent) {
      console.log(chalk.red(`Agent "${name}" 不存在`))
      return
    }
    printAgentDetail(agent)
  } else {
    const agents = store.getAllAgents()
    for (const agent of agents) {
      printAgentDetail(agent)
      console.log('')
    }
  }
}

function printAgentDetail(agent: Agent) {
  console.log(chalk.bold(`Agent: ${agent.name}`))
  console.log(chalk.gray(`  状态: ${agent.status}`))
  console.log(chalk.gray(`  人格: ${agent.persona}`))
  console.log(chalk.gray(`  完成任务: ${agent.stats.tasksCompleted}`))
  console.log(chalk.gray(`  失败任务: ${agent.stats.tasksFailed}`))

  if (agent.currentTask) {
    console.log(chalk.blue(`  当前任务: ${agent.currentTask}`))
  }
}
