import chalk from 'chalk'
import { writeFile } from 'fs/promises'
import { getStore } from '../store/index.js'
import { formatReport } from './formatReport.js'

interface ReportOptions {
  agent?: string
  days?: string
  output?: string
}

/**
 * 生成工作报告
 */
export async function generateReport(options: ReportOptions): Promise<void> {
  const store = getStore()
  const days = parseInt(options.days || '1', 10)

  // 计算时间范围
  const since = new Date()
  since.setDate(since.getDate() - days)

  // 获取任务
  let tasks = store.getAllTasks()

  // 筛选时间范围
  tasks = tasks.filter(t => new Date(t.createdAt) >= since)

  // 筛选 Agent
  if (options.agent) {
    tasks = tasks.filter(t => t.assignee === options.agent)
  }

  // 获取 Agent 信息
  const agents = options.agent
    ? [store.getAgent(options.agent)].filter((a): a is NonNullable<typeof a> => a !== null)
    : store.getAllAgents()

  // 统计数据
  const stats = {
    totalTasks: tasks.length,
    completed: tasks.filter(t => t.status === 'completed').length,
    inProgress: tasks.filter(t => ['planning', 'developing', 'reviewing'].includes(t.status)).length,
    pending: tasks.filter(t => t.status === 'pending').length,
    failed: tasks.filter(t => t.status === 'failed').length
  }

  // 待审批的分支
  const pendingBranches = tasks
    .filter(t => t.status === 'reviewing' && t.branch)
    .map(t => ({
      branch: t.branch!,
      task: t.title,
      agent: t.assignee
    }))

  // 生成报告
  const report = formatReport({
    period: { days, since: since.toISOString() },
    agents: agents.map(a => ({
      name: a.name,
      persona: a.persona,
      stats: a.stats,
    })),
    tasks,
    stats,
    pendingBranches
  })

  // 输出
  if (options.output) {
    await writeFile(options.output, report)
    console.log(chalk.green(`✓ 报告已保存到: ${options.output}`))
  } else {
    console.log(report)
  }
}
