/**
 * 守护进程重启
 *
 * 原子化执行 stop + start，确保无缝切换
 */

import chalk from 'chalk'
import { stopDaemon } from './stopDaemon.js'
import { startDaemon } from './startDaemon.js'
import { isServiceRunning } from './pidLock.js'

export interface RestartOptions {
  detach?: boolean
}

/**
 * 重启守护进程
 * 1. 优雅停止现有进程（如果有）
 * 2. 等待停止完成
 * 3. 启动新进程
 */
export async function restartDaemon(options: RestartOptions): Promise<void> {
  const { running } = isServiceRunning('daemon')

  if (running) {
    console.log(chalk.yellow('正在停止现有守护进程...'))
    await stopDaemon({})
    // 等待进程完全停止
    await new Promise(resolve => setTimeout(resolve, 1000))
  } else {
    console.log(chalk.gray('守护进程未运行，直接启动'))
  }

  console.log(chalk.green('启动新守护进程...'))
  await startDaemon({ detach: options.detach ?? true })
}
