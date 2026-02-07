import chalk from 'chalk'
import { getStore } from '../store/index.js'
import { getPidLock, releasePidLock } from './pidLock.js'

interface StopOptions {
  agent?: string
}

export async function stopDaemon(_options: StopOptions): Promise<void> {
  const store = getStore()

  // 优先使用 PID 锁文件
  const lock = getPidLock()
  const pid = lock?.pid || store.getDaemonPid()

  if (!pid) {
    console.log(chalk.yellow('守护进程未运行'))
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
    store.setDaemonPid(null)
    console.log(chalk.green(`✓ 已发送停止信号到进程 ${pid}`))

    // 清理 PID 锁文件
    releasePidLock()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      console.log(chalk.yellow('进程已不存在，清理残留文件'))
      store.setDaemonPid(null)
      releasePidLock()
    } else {
      throw error
    }
  }
}
