import chalk from 'chalk'
import { getStore } from '../store/index.js'

export async function getDaemonStatus(): Promise<void> {
  const store = getStore()
  const pid = store.getDaemonPid()

  if (!pid) {
    console.log(chalk.yellow('守护进程未运行'))
    return
  }

  // 检查进程是否存活
  try {
    process.kill(pid, 0) // 不发送信号，只检查
    console.log(chalk.green(`守护进程运行中 (PID: ${pid})`))

    // 显示运行中的任务
    const runningTasks = store.getTasksByStatus('planning')
      .concat(store.getTasksByStatus('developing'))
    if (runningTasks.length > 0) {
      console.log('')
      console.log(chalk.bold('运行中的任务:'))
      for (const task of runningTasks) {
        console.log(`  🔵 ${task.title}`)
      }
    }
  } catch {
    console.log(chalk.yellow('守护进程已停止'))
    store.setDaemonPid(null)
  }
}
