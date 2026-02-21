/**
 * Self-drive scheduler
 *
 * Simple setInterval-based scheduler that executes goals by creating tasks.
 * Runs inside the daemon process — no separate process needed.
 */

import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { spawnTaskRunner } from '../task/spawnTask.js'
import { getAllTasks } from '../store/TaskStore.js'
import { listEnabledGoals, markGoalRun, type DriveGoal } from './goals.js'

const logger = createLogger('selfdrive')

// Active timers keyed by goal ID
const activeTimers = new Map<string, ReturnType<typeof setInterval>>()

// ============ Schedule Parsing ============

/** Parse schedule string (e.g. '30m', '1h', '6h', '1d') to milliseconds */
function parseScheduleMs(schedule: string): number | null {
  const match = schedule.match(/^(\d+)(m|h|d)$/)
  if (!match) return null

  const value = parseInt(match[1]!, 10)
  if (value <= 0) return null
  const unit = match[2]!

  switch (unit) {
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: return null
  }
}

// ============ Goal → Task Mapping ============

const GOAL_TASK_DESCRIPTIONS: Record<string, string> = {
  'health-check': '[自驱] 健康检查',
  'evolve': '[自驱] 全局自进化',
  'cleanup': '[自驱] 遗忘清理',
}

const GOAL_TASK_PROMPTS: Record<string, string> = {
  'health-check': '执行系统健康检查（selfcheck），检查所有健康指标。如果发现问题，尝试自动修复可修复的项目，并为无法自动修复的问题生成修复任务。',
  'evolve': `执行一轮全局自进化周期：系统中的任何模块都可能成为改进对象，不限于任务模块。

分析范围：
- 查看最近运行过的所有任务（成功和失败），从执行日志、耗时、节点输出中提取信号
- 审查各模块的实际运行效果：workflow 引擎、persona 提示词、memory 检索、scheduling 策略、CLI 交互体验、通知消息格式等
- 识别重复出现的摩擦点、低效模式、可以自动化的手动操作

改进目标可以是：
- 提示词优化（persona、workflow 生成、记忆提取等）
- 代码逻辑改进（错误处理、性能、健壮性）
- 配置调整（调度频率、阈值、超时等）
- 新能力补全（发现系统缺少某个功能）

重要约束：
- 每轮只选择 2-3 个最高价值的改进，不要贪多
- 只实施低风险改进，排除涉及数据结构变更或核心引擎流程的修改
- 工作流节点数不要超过 5 个（含 start/end），保持简单
- 改进后必须运行 typecheck 验证，确保不引入回归

生成改进方案并应用，记录进化历史。`,
  'cleanup': '执行数据清理：清理过期日志、孤儿文件、过时的记忆条目等。',
}

// ============ Conflict Detection ============

/** Check if there's already a running selfdrive task for the same goal type */
function hasRunningSelfdriveTask(goalType: string): boolean {
  const runningStatuses = ['pending', 'planning', 'developing']
  const tasks = getAllTasks()

  return tasks.some(
    t => runningStatuses.includes(t.status) && t.source === 'selfdrive' && t.metadata?.goalType === goalType
  )
}

// ============ Goal Executors ============

async function executeGoal(goal: DriveGoal): Promise<void> {
  logger.info(`Executing goal: ${goal.type} (${goal.description})`)

  const description = GOAL_TASK_DESCRIPTIONS[goal.type]
  if (!description) {
    logger.warn(`Unknown goal type: ${goal.type}`)
    markGoalRun(goal.id, 'failure', `Unknown goal type: ${goal.type}`)
    return
  }

  // Check for running selfdrive task of same goal type
  if (hasRunningSelfdriveTask(goal.type)) {
    logger.info(`Skipping goal ${goal.id} (${goal.type}): selfdrive task of same type already running`)
    return
  }

  try {
    const prompt = GOAL_TASK_PROMPTS[goal.type] ?? description
    const task = createTaskWithFolder({
      title: description,
      description: prompt,
      source: 'selfdrive',
      metadata: { goalId: goal.id, goalType: goal.type },
    })

    logger.info(`Created selfdrive task: ${task.id} (${goal.type})`)

    // Trigger queue runner to pick up the new task
    spawnTaskRunner()

    markGoalRun(goal.id, 'success')
  } catch (error) {
    const message = getErrorMessage(error)
    logger.error(`Goal ${goal.type} failed to create task: ${message}`)
    markGoalRun(goal.id, 'failure', message)
  }
}

// ============ Scheduler Control ============

/** Check if a goal is due for execution based on schedule and lastRunAt */
function isDue(goal: DriveGoal): boolean {
  if (!goal.lastRunAt) return true
  const intervalMs = parseScheduleMs(goal.schedule)
  if (!intervalMs) return false
  const elapsed = Date.now() - new Date(goal.lastRunAt).getTime()
  return elapsed >= intervalMs
}

/** Start scheduling all enabled goals */
export function startScheduler(): void {
  stopScheduler()

  const goals = listEnabledGoals()
  logger.info(`Starting self-drive scheduler with ${goals.length} enabled goal(s)`)

  for (const goal of goals) {
    const intervalMs = parseScheduleMs(goal.schedule)
    if (!intervalMs) {
      logger.warn(`Invalid schedule for goal ${goal.id}: ${goal.schedule}`)
      continue
    }

    // Run immediately if due
    if (isDue(goal)) {
      executeGoal(goal).catch(err => logger.error(`Goal ${goal.id} error: ${getErrorMessage(err)}`))
    }

    // Schedule periodic execution
    const timer = setInterval(() => {
      executeGoal(goal).catch(err => logger.error(`Goal ${goal.id} error: ${getErrorMessage(err)}`))
    }, intervalMs)

    // Don't block process exit
    timer.unref()
    activeTimers.set(goal.id, timer)
  }
}

/** Stop all scheduled goals */
export function stopScheduler(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer)
    logger.debug(`Stopped goal timer: ${id}`)
  }
  activeTimers.clear()
}

/** Get scheduler status */
export function getSchedulerStatus(): {
  running: boolean
  activeGoals: number
  goalIds: string[]
} {
  return {
    running: activeTimers.size > 0,
    activeGoals: activeTimers.size,
    goalIds: [...activeTimers.keys()],
  }
}
