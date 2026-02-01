import chalk from 'chalk'

interface ReportData {
  period: {
    days: number
    since: string
  }
  agents: Array<{
    name: string
    stats: {
      tasksCompleted: number
      tasksFailed: number
    }
  }>
  tasks: Array<{
    id: string
    title: string
    status: string
    assignee?: string
  }>
  stats: {
    totalTasks: number
    completed: number
    inProgress: number
    pending: number
    failed: number
  }
  pendingBranches: Array<{
    branch: string
    task: string
    agent?: string
  }>
}

/**
 * 格式化报告输出
 */
export function formatReport(data: ReportData): string {
  const lines: string[] = []

  // 标题
  lines.push(chalk.bold('═══════════════════════════════════════'))
  lines.push(chalk.bold('       Claude Agent Hub 工作报告'))
  lines.push(chalk.bold('═══════════════════════════════════════'))
  lines.push('')

  // 时间范围
  lines.push(chalk.gray(`报告周期: 最近 ${data.period.days} 天`))
  lines.push(chalk.gray(`生成时间: ${new Date().toLocaleString()}`))
  lines.push('')

  // 统计摘要
  lines.push(chalk.bold('📊 任务统计'))
  lines.push(chalk.gray('───────────────────────────────────────'))
  lines.push(`  总任务数: ${data.stats.totalTasks}`)
  lines.push(chalk.green(`  已完成: ${data.stats.completed}`))
  lines.push(chalk.blue(`  进行中: ${data.stats.inProgress}`))
  lines.push(chalk.gray(`  待处理: ${data.stats.pending}`))
  if (data.stats.failed > 0) {
    lines.push(chalk.red(`  失败: ${data.stats.failed}`))
  }
  lines.push('')

  // Agent 表现
  if (data.agents.length > 0) {
    lines.push(chalk.bold('🤖 Agent 表现'))
    lines.push(chalk.gray('───────────────────────────────────────'))
    for (const agent of data.agents) {
      lines.push(`  ${agent.name}`)
      lines.push(chalk.gray(`    完成: ${agent.stats.tasksCompleted} | 失败: ${agent.stats.tasksFailed}`))
    }
    lines.push('')
  }

  // 待审批分支
  if (data.pendingBranches.length > 0) {
    lines.push(chalk.bold('⏳ 待审批 PR'))
    lines.push(chalk.gray('───────────────────────────────────────'))
    for (const pr of data.pendingBranches) {
      lines.push(chalk.yellow(`  • ${pr.branch}`))
      lines.push(chalk.gray(`    任务: ${pr.task}`))
      if (pr.agent) {
        lines.push(chalk.gray(`    执行者: ${pr.agent}`))
      }
    }
    lines.push('')
    lines.push(chalk.gray('使用 `cah approve <branch>` 审批'))
    lines.push(chalk.gray('使用 `cah reject <branch>` 拒绝'))
  } else {
    lines.push(chalk.green('✓ 无待审批的 PR'))
  }

  lines.push('')
  lines.push(chalk.gray('═══════════════════════════════════════'))

  return lines.join('\n')
}
