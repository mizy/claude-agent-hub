import { getStore } from '../store/index.js'
import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'

/**
 * Agent 轮询获取下一个待处理任务
 * 优先级顺序: high > medium > low
 * 同优先级按创建时间排序
 */
export async function pollTask(agent: Agent): Promise<Task | null> {
  const store = getStore()
  const tasks = store.getAllTasks()

  // 筛选待处理任务
  const pendingTasks = tasks.filter(t => {
    // 状态必须是 pending
    if (t.status !== 'pending') return false

    // 如果有指定执行者，必须匹配
    if (t.assignee && t.assignee !== agent.name) return false

    return true
  })

  if (pendingTasks.length === 0) {
    return null
  }

  // 按优先级和时间排序
  const priorityOrder = { high: 0, medium: 1, low: 2 }

  pendingTasks.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 1
    const pb = priorityOrder[b.priority] ?? 1

    if (pa !== pb) return pa - pb

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  return pendingTasks[0] ?? null
}
