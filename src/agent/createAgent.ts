import chalk from 'chalk'
import { getStore } from '../store/index.js'
import { loadPersona } from './persona/loadPersona.js'
import type { Agent, CreateAgentOptions } from '../types/agent.js'

export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const store = getStore()

  // 检查是否已存在同名 Agent
  const existing = store.getAgent(options.name)
  if (existing) {
    console.log(chalk.red(`Agent "${options.name}" 已存在`))
    process.exit(1)
  }

  // 加载人格配置
  const persona = await loadPersona(options.persona)

  const agent: Agent = {
    id: crypto.randomUUID(),
    name: options.name,
    persona: options.persona,
    personaConfig: persona,
    description: options.description || '',
    status: 'idle',
    createdAt: new Date().toISOString(),
    stats: {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalWorkTime: 0
    }
  }

  store.saveAgent(agent)

  console.log(chalk.green(`✓ Agent "${options.name}" 创建成功`))
  console.log(chalk.gray(`  人格: ${options.persona}`))
  console.log(chalk.gray(`  ID: ${agent.id}`))

  return agent
}
