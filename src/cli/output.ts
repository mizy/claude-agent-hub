/**
 * CLI 输出工具
 * 统一的输出格式，支持表格、列表、状态等
 */

import chalk from 'chalk'
import { table } from 'table'

// 成功消息
export function success(message: string): void {
  console.log(chalk.green('✓'), message)
}

// 错误消息
export function error(message: string): void {
  console.error(chalk.red('✗'), message)
}

// 警告消息
export function warn(message: string): void {
  console.warn(chalk.yellow('!'), message)
}

// 信息消息
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message)
}

// 标题
export function heading(text: string): void {
  console.log()
  console.log(chalk.bold.underline(text))
  console.log()
}

// 子标题
export function subheading(text: string): void {
  console.log(chalk.dim('─'.repeat(40)))
  console.log(chalk.bold(text))
  console.log(chalk.dim('─'.repeat(40)))
}

// 键值对
export function keyValue(key: string, value: string | number): void {
  console.log(`  ${chalk.dim(key + ':')} ${value}`)
}

// 列表项
export function listItem(text: string, indent: number = 0): void {
  const prefix = '  '.repeat(indent) + chalk.dim('•')
  console.log(`${prefix} ${text}`)
}

// 表格输出
export function printTable(
  headers: string[],
  rows: (string | number)[][],
  options?: { compact?: boolean }
): void {
  const data = [headers.map(h => chalk.bold(h)), ...rows.map(row => row.map(String))]

  const config = options?.compact
    ? {
        border: {
          topBody: '',
          topJoin: '',
          topLeft: '',
          topRight: '',
          bottomBody: '',
          bottomJoin: '',
          bottomLeft: '',
          bottomRight: '',
          bodyLeft: '',
          bodyRight: '',
          bodyJoin: chalk.dim('│'),
          joinBody: chalk.dim('─'),
          joinLeft: '',
          joinRight: '',
          joinJoin: chalk.dim('┼'),
        },
        drawHorizontalLine: (index: number, size: number) => index === 1,
      }
    : undefined

  console.log(table(data, config))
}

// 状态标签
export function statusBadge(
  status: string,
  type: 'success' | 'warning' | 'error' | 'info' | 'muted' = 'info'
): string {
  const colors = {
    success: chalk.bgGreen.black,
    warning: chalk.bgYellow.black,
    error: chalk.bgRed.white,
    info: chalk.bgBlue.white,
    muted: chalk.bgGray.white,
  }
  return colors[type](` ${status} `)
}

// 进度条
export function progressBar(current: number, total: number, width: number = 30): string {
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty))
  const percent = Math.round((current / total) * 100)
  return `${bar} ${percent}%`
}

// 空行
export function blank(): void {
  console.log()
}

// 分隔线
export function divider(char: string = '─', length: number = 40): void {
  console.log(chalk.dim(char.repeat(length)))
}

// JSON 输出（用于脚本集成）
export function json<T>(data: T): void {
  console.log(JSON.stringify(data, null, 2))
}
