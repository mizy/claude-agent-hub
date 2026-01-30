/**
 * 执行待处理任务
 */

import { getOrCreateDefaultAgent } from './getDefaultAgent.js'
import { runAgent } from './runAgent.js'

/**
 * 使用默认 Agent 执行待处理任务
 */
export async function runTasks(): Promise<void> {
  // 确保默认 Agent 存在
  const agent = await getOrCreateDefaultAgent()

  // 执行任务
  await runAgent(agent.name)
}
