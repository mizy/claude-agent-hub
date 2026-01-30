/**
 * CLI 交互式提示
 * 基于 inquirer 的简化封装
 */

import inquirer from 'inquirer'

// 确认提示
export async function confirm(message: string, defaultValue: boolean = false): Promise<boolean> {
  const { result } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'result',
      message,
      default: defaultValue,
    },
  ])
  return result
}

// 文本输入
export async function input(
  message: string,
  options?: { default?: string; required?: boolean }
): Promise<string> {
  const { result } = await inquirer.prompt([
    {
      type: 'input',
      name: 'result',
      message,
      default: options?.default,
      validate: value => {
        if (options?.required && !value.trim()) {
          return 'This field is required'
        }
        return true
      },
    },
  ])
  return result
}

// 密码输入
export async function password(message: string): Promise<string> {
  const { result } = await inquirer.prompt([
    {
      type: 'password',
      name: 'result',
      message,
      mask: '*',
    },
  ])
  return result
}

// 单选
export async function select<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T } | T>
): Promise<T> {
  const { result } = await inquirer.prompt([
    {
      type: 'list',
      name: 'result',
      message,
      choices: choices.map(c => (typeof c === 'string' ? { name: c, value: c } : c)),
    },
  ])
  return result
}

// 多选
export async function multiSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean } | T>
): Promise<T[]> {
  const { result } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'result',
      message,
      choices: choices.map(c =>
        typeof c === 'string' ? { name: c, value: c, checked: false } : c
      ),
    },
  ])
  return result
}

// 编辑器输入（用于长文本）
export async function editor(message: string, defaultValue?: string): Promise<string> {
  const { result } = await inquirer.prompt([
    {
      type: 'editor',
      name: 'result',
      message,
      default: defaultValue,
    },
  ])
  return result
}

// 数字输入
export async function number(
  message: string,
  options?: { default?: number; min?: number; max?: number }
): Promise<number> {
  const { result } = await inquirer.prompt([
    {
      type: 'number',
      name: 'result',
      message,
      default: options?.default,
      validate: value => {
        if (options?.min !== undefined && value < options.min) {
          return `Value must be at least ${options.min}`
        }
        if (options?.max !== undefined && value > options.max) {
          return `Value must be at most ${options.max}`
        }
        return true
      },
    },
  ])
  return result
}
