/**
 * macOS sleep prevention via caffeinate
 *
 * Prevents idle sleep while daemon is running.
 * Display sleep (lid close) still works normally.
 */

import { spawn, type ChildProcess } from 'child_process'
import chalk from 'chalk'

let caffeinateProcess: ChildProcess | null = null

/** Start caffeinate -i to prevent idle sleep (macOS only) */
export function startSleepPrevention(): void {
  if (process.platform !== 'darwin') return

  try {
    caffeinateProcess = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      detached: true,
      stdio: 'ignore',
    })
    caffeinateProcess.unref()
    console.log(chalk.green('  ✓ 防睡眠已启用 (caffeinate -i)'))
    console.log(chalk.gray('  ℹ 允许显示器自动息屏，后台进程继续运行'))
    console.log(chalk.gray('  ℹ 合盖会自动睡眠（正常行为）'))
  } catch {
    console.warn(chalk.yellow('  ⚠ 防睡眠启动失败'))
  }
}

/** Stop caffeinate */
export function stopSleepPrevention(): void {
  if (caffeinateProcess) {
    caffeinateProcess.kill()
    caffeinateProcess = null
  }
}
