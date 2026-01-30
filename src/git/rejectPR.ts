import { execa } from 'execa'
import chalk from 'chalk'
import { getStore } from '../store/index.js'

interface RejectOptions {
  message?: string
}

/**
 * 拒绝 PR 分支
 */
export async function rejectPR(branch: string, options: RejectOptions): Promise<void> {
  const store = getStore()

  console.log(chalk.yellow(`拒绝分支: ${branch}`))

  if (options.message) {
    console.log(chalk.gray(`原因: ${options.message}`))
  }

  // 查找关联的任务
  const tasks = store.getAllTasks()
  const relatedTask = tasks.find(t => t.branch === branch)

  if (relatedTask) {
    // 将任务状态改回 pending，允许重试
    store.updateTask(relatedTask.id, {
      status: 'pending',
      retryCount: relatedTask.retryCount + 1,
      lastRejectReason: options.message
    })
    console.log(chalk.gray(`任务 ${relatedTask.id.slice(0, 8)} 已重置为 pending`))
  }

  // 删除分支
  try {
    await execa('git', ['branch', '-D', branch])
    console.log(chalk.gray(`已删除分支: ${branch}`))
  } catch {
    console.log(chalk.yellow(`分支 ${branch} 不存在或无法删除`))
  }

  console.log(chalk.green('✓ PR 已拒绝'))
}
