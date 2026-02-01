import chalk from 'chalk'
import { getStore } from '../store/index.js'

interface StopOptions {
  agent?: string
}

export async function stopDaemon(_options: StopOptions): Promise<void> {
  const store = getStore()
  const pid = store.getDaemonPid()

  if (!pid) {
    console.log(chalk.yellow('守护进程未运行'))
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
    store.setDaemonPid(null)
    console.log(chalk.green(`✓ 已发送停止信号到进程 ${pid}`))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      console.log(chalk.yellow('进程已不存在'))
      store.setDaemonPid(null)
    } else {
      throw error
    }
  }
}
