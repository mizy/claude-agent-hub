import { writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import YAML from 'yaml'

interface InitOptions {
  force?: boolean
}

const DEFAULT_CONFIG = `# Claude Agent Hub 配置文件

# Agent 配置
agents:
  - name: dev
    persona: Pragmatist
    schedule:
      poll_interval: 5m      # 任务轮询间隔

  # 可以添加更多 Agent
  # - name: reviewer
  #   persona: Perfectionist
  #   role: reviewer

# 任务配置
tasks:
  default_priority: medium
  max_retries: 3
  timeout: 30m

# Git 配置
git:
  base_branch: main
  branch_prefix: "agent/"
  auto_push: false          # 需要人工确认才推送

# Claude Code 配置
claude:
  model: sonnet             # haiku | sonnet | opus
  max_tokens: 8000
`

/**
 * 初始化项目配置
 */
export async function initProject(options: InitOptions): Promise<void> {
  const configPath = join(process.cwd(), '.claude-agent-hub.yaml')

  if (existsSync(configPath) && !options.force) {
    console.log(chalk.yellow('配置文件已存在，使用 --force 覆盖'))
    return
  }

  await writeFile(configPath, DEFAULT_CONFIG)
  console.log(chalk.green('✓ 配置文件已创建: .claude-agent-hub.yaml'))

  // 创建数据目录
  const dataDir = join(process.cwd(), '.claude-agent-hub')
  if (!existsSync(dataDir)) {
    const { mkdir } = await import('fs/promises')
    await mkdir(dataDir, { recursive: true })
    console.log(chalk.green('✓ 数据目录已创建: .claude-agent-hub/'))
  }

  console.log('')
  console.log(chalk.bold('下一步:'))
  console.log(chalk.gray('  1. 编辑 .claude-agent-hub.yaml 配置 Agent'))
  console.log(chalk.gray('  2. 运行 `cah agent create -n <name>` 创建 Agent'))
  console.log(chalk.gray('  3. 运行 `cah task add -t <title>` 添加任务'))
  console.log(chalk.gray('  4. 运行 `cah start` 启动守护进程'))
}
