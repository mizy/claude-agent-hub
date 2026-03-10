import { getAllTasks } from '../store/TaskStore.js'

export function hasRunningSelfdriveTask(goalType: string): boolean {
  const runningStatuses = ['pending', 'planning', 'developing']
  const tasks = getAllTasks()

  return tasks.some(
    t => runningStatuses.includes(t.status) && t.source === 'selfdrive' && t.metadata?.goalType === goalType
  )
}
