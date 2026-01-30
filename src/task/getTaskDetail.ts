import chalk from 'chalk'
import { getStore } from '../store/index.js'

export async function getTaskDetail(id: string): Promise<void> {
  const store = getStore()
  const task = store.getTask(id)

  if (!task) {
    console.log(chalk.red(`任务 "${id}" 不存在`))
    return
  }

  console.log(chalk.bold(`任务: ${task.title}`))
  console.log(chalk.gray('─'.repeat(50)))
  console.log(chalk.gray(`ID: ${task.id}`))
  console.log(chalk.gray(`状态: ${task.status}`))
  console.log(chalk.gray(`优先级: ${task.priority}`))
  console.log(chalk.gray(`执行者: ${task.assignee || '未分配'}`))
  console.log(chalk.gray(`创建时间: ${task.createdAt}`))

  if (task.description) {
    console.log('')
    console.log(chalk.bold('描述:'))
    console.log(task.description)
  }

  if (task.plan) {
    console.log('')
    console.log(chalk.bold('执行计划:'))
    console.log(chalk.gray(`分析: ${task.plan.analysis}`))
    console.log(chalk.gray(`涉及文件: ${task.plan.files.join(', ')}`))
    console.log(chalk.gray('步骤:'))
    for (const step of task.plan.steps) {
      console.log(chalk.gray(`  ${step.order}. ${step.action}`))
    }
  }

  if (task.branch) {
    console.log('')
    console.log(chalk.gray(`分支: ${task.branch}`))
  }
}
