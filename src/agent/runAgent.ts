/**
 * Agent 主运行循环
 * 轮询获取任务并使用 executeAgent 执行
 * @entry
 */

import { getStore } from '../store/index.js'
import { pollTask } from '../task/pollTask.js'
import { executeAgent } from './executeAgent.js'

/**
 * Agent 主运行循环
 *
 * 流程：
 * 1. 轮询获取任务
 * 2. 调用 executeAgent 执行任务
 *
 * 与 runAgentForTask 不同，这个函数：
 * - 使用轮询获取任务
 * - 输出保存到全局 outputs/ 目录
 * - 使用 console.log 输出（前台模式）
 */
export async function runAgent(agentName: string): Promise<void> {
  const store = getStore()
  const agent = store.getAgent(agentName)

  if (!agent) {
    throw new Error(`Agent "${agentName}" 不存在`)
  }

  console.log(`[${agent.name}] Agent 启动`)

  // 更新状态为工作中
  store.updateAgent(agent.name, { status: 'working' })

  try {
    // 1. 轮询获取任务
    const task = await pollTask(agent)
    if (!task) {
      console.log(`[${agent.name}] 无待处理任务`)
      store.updateAgent(agent.name, { status: 'idle' })
      return
    }

    console.log(`[${agent.name}] 领取任务: ${task.title}`)

    // 2. 使用 executeAgent 执行任务
    await executeAgent(agent, task, {
      concurrency: 1, // Agent 一次只处理一个节点
      saveToTaskFolder: false, // 保存到全局 outputs/
      useConsole: true, // 使用 console.log
    })
  } catch (error) {
    console.error(`[${agent.name}] 执行出错:`, error)

    store.updateAgent(agent.name, {
      status: 'idle',
      stats: {
        ...agent.stats,
        tasksFailed: agent.stats.tasksFailed + 1,
      },
    })
  }
}
