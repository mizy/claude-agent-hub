/**
 * 默认运行命令
 * 支持简化的命令格式：
 *   cah "修复我的tickets"     - 直接创建并运行任务
 *   cah ~/projects/prd.md    - 从文件创建工作流
 */

import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import chalk from 'chalk'
import {
  parseMarkdown,
  validateMarkdown,
  saveWorkflow,
  startWorkflow,
} from '../../workflow/index.js'
import { createTask } from '../../task/createTask.js'
import { success, error, info } from '../output.js'
import { withSpinner } from '../spinner.js'

// 统一的选项类型
interface RunOptions {
  start?: boolean
  agent?: string
}

/**
 * 处理默认命令
 * 自动判断输入是文件路径还是任务描述
 */
export async function runDefault(input: string, options: RunOptions): Promise<void> {
  // 展开 ~ 为 home 目录
  const expandedPath = input.startsWith('~')
    ? input.replace('~', process.env.HOME || '')
    : input

  const resolvedPath = resolve(expandedPath)

  // 判断是否为文件路径
  if (isFilePath(input) && existsSync(resolvedPath)) {
    await runFromFile(resolvedPath, options)
  } else {
    await runFromPrompt(input, options)
  }
}

/**
 * 判断输入是否像文件路径
 */
function isFilePath(input: string): boolean {
  // 以 ./ ../ / ~ 开头，或者包含文件扩展名
  return (
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('/') ||
    input.startsWith('~') ||
    /\.\w+$/.test(input)  // 有扩展名
  )
}

/**
 * 从文件创建并运行工作流
 */
async function runFromFile(filePath: string, options: RunOptions): Promise<void> {
  const ext = filePath.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'markdown') {
    await runMarkdownWorkflow(filePath, options)
  } else {
    // 其他文件类型：读取内容作为任务描述
    const content = await readFile(filePath, 'utf-8')
    await runFromPrompt(content, options)
  }
}

/**
 * 从 Markdown 文件创建并运行工作流
 */
async function runMarkdownWorkflow(filePath: string, options: RunOptions): Promise<void> {
  const content = await readFile(filePath, 'utf-8')

  // 验证格式
  const validation = validateMarkdown(content)
  if (!validation.valid) {
    error('Invalid markdown format:')
    for (const err of validation.errors) {
      console.log(chalk.red(`  - ${err}`))
    }
    return
  }

  // 解析并保存工作流
  const workflow = await withSpinner(
    'Creating workflow...',
    async () => {
      const wf = parseMarkdown(content, filePath)
      saveWorkflow(wf)
      return wf
    }
  )

  success(`Created workflow: ${workflow.name}`)
  console.log(chalk.gray(`  ID: ${workflow.id}`))
  console.log(chalk.gray(`  Tasks: ${workflow.nodes.length - 2}`))

  // 默认自动启动（除非明确指定 --no-start）
  if (options.start !== false) {
    const instance = await withSpinner(
      'Starting workflow...',
      () => startWorkflow(workflow.id)
    )
    success('Workflow started')
    console.log(chalk.gray(`  Instance: ${instance.id}`))
    console.log()
    info(`Use ${chalk.cyan('cah workflow status ' + workflow.id.slice(0, 8))} to check progress`)
  }
}

/**
 * 从提示词直接创建并运行任务
 */
async function runFromPrompt(prompt: string, options: RunOptions): Promise<void> {
  // 从提示词提取标题（取前 50 个字符）
  const title = prompt.length > 50
    ? prompt.slice(0, 50) + '...'
    : prompt

  const task = await withSpinner(
    'Creating task...',
    () => createTask({
      title,
      description: prompt,
      priority: 'medium',
      assignee: options.agent,
    })
  )

  success(`Created task: ${task.title}`)
  console.log(chalk.gray(`  ID: ${task.id}`))

  info(`Task queued for processing`)
  console.log()
  console.log(chalk.dim('Tips:'))
  console.log(chalk.dim(`  - Check status: ${chalk.cyan('cah task show ' + task.id.slice(0, 8))}`))
  console.log(chalk.dim(`  - List tasks:   ${chalk.cyan('cah task list')}`))
}
