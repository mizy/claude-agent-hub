import chalk from 'chalk'
import { getStore } from '../store/index.js'
import { isServiceRunning } from './pidLock.js'

export async function getDaemonStatus(): Promise<void> {
  const store = getStore()
  const { running, lock } = isServiceRunning('daemon')

  if (!running) {
    console.log(chalk.yellow('守护进程未运行'))
    if (lock) {
      console.log(chalk.gray(`  (发现僵尸 PID: ${lock.pid}，已清理)`))
    }
    return
  }

  if (!lock) {
    console.log(chalk.yellow('守护进程未运行'))
    return
  }

  // 显示守护进程信息
  console.log(chalk.green(`守护进程运行中`))
  console.log(chalk.gray('─'.repeat(60)))
  console.log(`${chalk.bold('PID:')}        ${lock.pid}`)
  console.log(`${chalk.bold('启动时间:')}   ${new Date(lock.startedAt).toLocaleString('zh-CN')}`)
  console.log(`${chalk.bold('工作目录:')}   ${lock.cwd}`)

  // 计算运行时间
  const startTime = new Date(lock.startedAt).getTime()
  const uptime = Date.now() - startTime
  const hours = Math.floor(uptime / 3600000)
  const minutes = Math.floor((uptime % 3600000) / 60000)
  console.log(`${chalk.bold('运行时间:')}   ${hours}h ${minutes}m`)

  // 显示运行中的任务
  const runningTasks = store
    .getTasksByStatus('planning')
    .concat(store.getTasksByStatus('developing'))
  if (runningTasks.length > 0) {
    console.log('')
    console.log(chalk.bold('运行中的任务:'))
    for (const task of runningTasks) {
      console.log(`  🔵 ${task.title}`)
    }
  } else {
    console.log('')
    console.log(chalk.gray('当前无运行中的任务'))
  }
}
