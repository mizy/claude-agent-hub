/**
 * CLI Spinner 封装
 * 基于 ora，提供简洁的 loading 状态管理
 */

import ora, { type Ora } from 'ora'

export interface Spinner {
  start(text?: string): void
  stop(): void
  succeed(text?: string): void
  fail(text?: string): void
  warn(text?: string): void
  info(text?: string): void
  text(text: string): void
}

let activeSpinner: Ora | null = null

export function createSpinner(text?: string): Spinner {
  const spinner = ora({
    text,
    spinner: 'dots',
  })

  return {
    start(newText?: string) {
      if (activeSpinner) {
        activeSpinner.stop()
      }
      if (newText) spinner.text = newText
      activeSpinner = spinner.start()
    },
    stop() {
      spinner.stop()
      activeSpinner = null
    },
    succeed(newText?: string) {
      spinner.succeed(newText)
      activeSpinner = null
    },
    fail(newText?: string) {
      spinner.fail(newText)
      activeSpinner = null
    },
    warn(newText?: string) {
      spinner.warn(newText)
      activeSpinner = null
    },
    info(newText?: string) {
      spinner.info(newText)
      activeSpinner = null
    },
    text(newText: string) {
      spinner.text = newText
    },
  }
}

// 执行异步任务并显示 spinner
export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  options?: {
    successText?: string | ((result: T) => string)
    failText?: string | ((error: Error) => string)
  }
): Promise<T> {
  const spinner = createSpinner(text)
  spinner.start()

  try {
    const result = await task()
    const successText =
      typeof options?.successText === 'function'
        ? options.successText(result)
        : options?.successText
    spinner.succeed(successText)
    return result
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    const failText =
      typeof options?.failText === 'function' ? options.failText(error) : options?.failText
    spinner.fail(failText ?? error.message)
    throw e
  }
}

// 停止当前活跃的 spinner
export function stopActiveSpinner(): void {
  if (activeSpinner) {
    activeSpinner.stop()
    activeSpinner = null
  }
}
