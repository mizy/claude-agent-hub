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

    // 显示 Agent 状态
    const agents = store.getAllAgents()
    console.log('')
    console.log(chalk.bold('Agent 状态:'))
    for (const agent of agents) {
      const statusIcon = {
        idle: '⚪',
        working: '🔵',
        waiting: '🟡'
      }[agent.status] || '⚪'

      console.log(`  ${statusIcon} ${agent.name}: ${agent.status}`)
      if (agent.currentTask) {
        console.log(chalk.gray(`     当前任务: ${agent.currentTask}`))
      }
    }
  } catch {
    console.log(chalk.yellow('守护进程已停止'))
    store.setDaemonPid(null)
  }
}
