/**
 * 获取或创建默认 Agent
 */

import { getStore } from '../store/index.js'
import { loadPersona } from './persona/loadPersona.js'
import type { Agent } from '../types/agent.js'

const DEFAULT_AGENT_NAME = 'default'
const DEFAULT_PERSONA = 'Pragmatist'

/**
 * 获取默认 Agent，如果不存在则自动创建
 */
export async function getOrCreateDefaultAgent(): Promise<Agent> {
  const store = getStore()

  // 尝试获取已有的默认 Agent
  let agent = store.getAgent(DEFAULT_AGENT_NAME)

  if (!agent) {
    // 自动创建默认 Agent
    const persona = await loadPersona(DEFAULT_PERSONA)

    agent = {
      id: crypto.randomUUID(),
      name: DEFAULT_AGENT_NAME,
      persona: DEFAULT_PERSONA,
      personaConfig: persona,
      description: '内置默认执行 Agent',
      status: 'idle',
      createdAt: new Date().toISOString(),
      stats: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalWorkTime: 0
      }
    }

    store.saveAgent(agent)
  }

  return agent
}
