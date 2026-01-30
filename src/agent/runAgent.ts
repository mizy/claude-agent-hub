import { getStore } from '../store/index.js'
import { pollTask } from '../task/pollTask.js'
import { executePlan } from './executePlan.js'
import { generatePlan } from './generatePlan.js'
import { createBranch } from '../git/createBranch.js'
import { now } from '../shared/time.js'
import { saveTaskOutput, generateTaskTitle, isGenericTitle } from '../output/index.js'
import type { AgentContext } from '../types/agent.js'
import type { TaskExecutionResult } from '../types/output.js'

/**
 * Agent 主运行循环
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
    store.updateTask(task.id, {
      status: 'planning',
      assignee: agent.name
    })

    // 2. 创建工作分支
    const branchName = `agent/${agent.name}/task-${task.id.slice(0, 8)}`
    await createBranch(branchName)

    // 3. 生成执行计划
    const context: AgentContext = {
      agent,
      task,
      branch: branchName
    }

    const plan = await generatePlan(context)

    // 如果标题是通用的，生成一个描述性标题
    if (isGenericTitle(task.title)) {
      const generatedTitle = await generateTaskTitle(task, plan)
      task.title = generatedTitle
      store.updateTask(task.id, { title: generatedTitle })
      console.log(`[${agent.name}] 生成标题: ${generatedTitle}`)
    }

    store.updateTask(task.id, {
      status: 'developing',
      plan
    })

    // 4. 执行计划并记录开始时间
    const startedAt = now()
    const stepOutputs = await executePlan(context, plan)
    const completedAt = now()

    // 5. 保存执行结果
    const executionResult: TaskExecutionResult = {
      task,
      agent,
      branch: branchName,
      plan,
      stepOutputs,
      timing: { startedAt, completedAt }
    }

    try {
      const outputPath = await saveTaskOutput(executionResult)
      console.log(`[${agent.name}] 输出已保存: ${outputPath}`)
    } catch (err) {
      console.warn(`[${agent.name}] 保存输出失败:`, err)
      // 不影响任务完成
    }

    // 6. 完成任务
    store.updateTask(task.id, { status: 'reviewing' })
    store.updateAgent(agent.name, {
      status: 'idle',
      stats: {
        ...agent.stats,
        tasksCompleted: agent.stats.tasksCompleted + 1
      }
    })

    console.log(`[${agent.name}] 任务完成: ${task.title}`)

  } catch (error) {
    console.error(`[${agent.name}] 执行出错:`, error)
    store.updateAgent(agent.name, {
      status: 'idle',
      stats: {
        ...agent.stats,
        tasksFailed: agent.stats.tasksFailed + 1
      }
    })
  }
}
