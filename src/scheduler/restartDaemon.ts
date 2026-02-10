/**
 * 守护进程重启
 *
 * 原子化执行 stop + start，确保无缝切换
 */

import chalk from 'chalk'
import { stopDaemon } from './stopDaemon.js'
import { isServiceRunning } from './pidLock.js'

export interface RestartOptions {
  detach?: boolean
}

/**
 * 重启守护进程
 * 1. 优雅停止现有进程（如果有）
 * 2. 等待停止完成
 * 3. 通过 spawn 新进程启动（避免模块缓存问题）
 */
export async function restartDaemon(_options: RestartOptions): Promise<void> {
  const { running } = isServiceRunning('daemon')

  if (running) {
    console.log(chalk.yellow('正在停止现有守护进程...'))
    await stopDaemon({})
    // 等待进程完全停止
    await new Promise(resolve => setTimeout(resolve, 1500))
  } else {
    console.log(chalk.gray('守护进程未运行，直接启动'))
  }

  console.log(chalk.green('启动新守护进程...'))

  // 通过 spawn 新进程启动，避免当前进程的模块缓存影响
  // 使用 bin/cah.js start -D 启动，确保加载最新构建的 dist 文件
  const { spawn } = await import('child_process')
  const { resolve } = await import('path')

  const binPath = resolve(process.cwd(), 'bin/cah.js')
  const child = spawn(process.execPath, [binPath, 'start', '-D'], {
    detached: true,
    stdio: 'ignore', // 完全分离子进程，避免阻塞父进程
    env: process.env,
  })

  if (!child.pid) {
    console.log(chalk.red('✗ 守护进程启动失败：无法获取进程 PID'))
    return
  }

  child.unref()

  // 等待并验证进程启动
  await new Promise(resolve => setTimeout(resolve, 2000))
  const { running: started } = isServiceRunning('daemon')
  if (started) {
    console.log(chalk.green('✓ 守护进程已成功重启'))
  } else {
    console.log(chalk.yellow('⚠ 启动命令已发送，但守护进程尚未就绪'))
    console.log(chalk.gray('  使用 cah status 确认状态'))
  }
}
