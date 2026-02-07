/**
 * 查看守护进程日志
 */

import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import chalk from 'chalk'
import { DATA_DIR } from '../store/paths.js'

export interface ShowLogsOptions {
  follow?: boolean
  lines?: string
  error?: boolean
}

export async function showDaemonLogs(options: ShowLogsOptions): Promise<void> {
  const logFile = options.error ? join(DATA_DIR, 'daemon.err.log') : join(DATA_DIR, 'daemon.log')

  if (!existsSync(logFile)) {
    console.log(chalk.yellow(`日志文件不存在: ${logFile}`))
    console.log(chalk.gray('提示: 使用 cah serve -D 启动后台守护进程后会生成日志'))
    return
  }

  console.log(chalk.gray(`日志文件: ${logFile}\n`))

  if (options.follow) {
    // 使用 tail -f 持续监听
    const tail = spawn('tail', ['-f', logFile], {
      stdio: 'inherit',
    })

    // 监听退出信号
    process.on('SIGINT', () => {
      tail.kill()
      console.log('\n')
      process.exit(0)
    })

    // 等待 tail 进程结束
    await new Promise<void>(resolve => {
      tail.on('close', () => resolve())
    })
  } else {
    // 显示最后 N 行
    const lines = parseInt(options.lines || '50', 10)
    const content = readFileSync(logFile, 'utf-8')
    const allLines = content.trim().split('\n')
    const displayLines = allLines.slice(-lines)

    console.log(displayLines.join('\n'))

    if (allLines.length > lines) {
      console.log(chalk.gray(`\n... (共 ${allLines.length} 行，显示最后 ${lines} 行)`))
      console.log(chalk.gray(`使用 -n <count> 显示更多行，或 -f 持续监听`))
    }
  }
}
