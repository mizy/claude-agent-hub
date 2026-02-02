/**
 * CLI 用户输出工具
 * 用于面向用户的终端输出，简洁友好，无时间戳
 *
 * 使用场景：
 * - CLI 命令的用户反馈（成功、错误、警告、信息）
 * - 任务列表、详情等结构化展示
 * - 执行进度显示
 *
 * 注意：这些函数仅用于终端用户交互，不用于诊断日志
 * 诊断日志请使用 shared/logger.ts
 */

import chalk from 'chalk'

// ============ 基础输出 ============

/** 成功消息 */
export function success(message: string): void {
  console.log(chalk.green('✓'), message)
}

/** 错误消息 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message)
}

/** 警告消息 */
export function warn(message: string): void {
  console.warn(chalk.yellow('!'), message)
}

/** 信息消息 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message)
}

// ============ 结构化输出 ============

/** 输出标题行 */
export function header(title: string): void {
  console.log()
  console.log(chalk.bold(title))
  console.log(chalk.dim('─'.repeat(Math.min(title.length + 4, 40))))
}

/** 输出分隔线 */
export function divider(char = '─', length = 40): void {
  console.log(chalk.dim(char.repeat(length)))
}

/** 输出空行 */
export function blank(): void {
  console.log()
}

// ============ 列表输出 ============

export interface ListItem {
  label: string
  value: string | number | undefined
  /** 是否使用暗色显示值 */
  dim?: boolean
}

/** 输出键值对列表 */
export function list(items: ListItem[], indent = 2): void {
  const prefix = ' '.repeat(indent)
  const maxLabelLen = Math.max(...items.map(i => i.label.length))

  for (const item of items) {
    const label = chalk.gray(item.label.padEnd(maxLabelLen) + ':')
    const value = item.value ?? '-'
    const valueStr = item.dim ? chalk.dim(value) : String(value)
    console.log(`${prefix}${label} ${valueStr}`)
  }
}

/** 输出简单列表（带符号前缀） */
export function bulletList(items: string[], bullet = '•', indent = 2): void {
  const prefix = ' '.repeat(indent)
  for (const item of items) {
    console.log(`${prefix}${chalk.dim(bullet)} ${item}`)
  }
}

// ============ 进度输出 ============

/** 输出步骤进度 [1/5] 消息 */
export function step(current: number, total: number, message: string): void {
  const progress = chalk.cyan(`[${current}/${total}]`)
  console.log(`${progress} ${message}`)
}

/** 输出进度条 */
export function progress(label: string, current: number, total: number, width = 20): void {
  const percent = Math.round((current / total) * 100)
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty))
  console.log(`${label} [${bar}] ${percent}%`)
}

/** 单行更新进度（覆盖当前行，仅 TTY） */
export function progressInline(label: string, current: number, total: number, width = 20): void {
  if (!process.stdout.isTTY) {
    // 非 TTY 环境，每 10% 输出一次
    const percent = Math.round((current / total) * 100)
    if (percent % 10 === 0 || current === total) {
      progress(label, current, total, width)
    }
    return
  }

  const percent = Math.round((current / total) * 100)
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty))
  process.stdout.write(`\r${label} [${bar}] ${percent}%`)

  if (current === total) {
    process.stdout.write('\n')
  }
}

// ============ 表格输出 ============

export interface TableColumn {
  key: string
  header: string
  width?: number
  align?: 'left' | 'right'
}

/** 输出简单表格 */
export function table<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[]
): void {
  if (data.length === 0) {
    console.log(chalk.dim('  (无数据)'))
    return
  }

  // 计算列宽
  const widths = columns.map(col => {
    if (col.width) return col.width
    const headerLen = col.header.length
    const maxDataLen = Math.max(...data.map(row => String(row[col.key] ?? '').length))
    return Math.max(headerLen, maxDataLen)
  })

  // 输出表头
  const headerRow = columns.map((col, i) => {
    const width = widths[i] ?? col.header.length
    const text = col.header.padEnd(width)
    return chalk.bold(text)
  }).join('  ')
  console.log('  ' + headerRow)

  // 输出分隔线
  const separator = widths.map(w => '─'.repeat(w)).join('──')
  console.log('  ' + chalk.dim(separator))

  // 输出数据行
  for (const row of data) {
    const rowStr = columns.map((col, i) => {
      const width = widths[i] ?? 10
      const value = String(row[col.key] ?? '')
      return col.align === 'right'
        ? value.padStart(width)
        : value.padEnd(width)
    }).join('  ')
    console.log('  ' + rowStr)
  }
}

// ============ 命名空间导出 ============

export const ui = {
  // 基础
  success,
  error,
  warn,
  info,
  // 结构
  header,
  divider,
  blank,
  // 列表
  list,
  bulletList,
  // 进度
  step,
  progress,
  progressInline,
  // 表格
  table,
}
