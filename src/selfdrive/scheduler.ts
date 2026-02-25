/**
 * Self-drive scheduler
 *
 * Simple setInterval-based scheduler that executes goals by creating tasks.
 * Runs inside the daemon process — no separate process needed.
 *
 * Goal dimensions: evolve (unified), cleanup. (evolve-conversation/evolve-feature deprecated, merged into evolve)
 * Prompts are context-aware — CAH project vs external project generate different prompts.
 */

import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { spawnTaskRunner } from '../task/spawnTask.js'
import { getAllTasks } from '../store/TaskStore.js'
import { ensureBuiltinGoals, listEnabledGoals, markGoalRun, type DriveGoal } from './goals.js'
import { detectSignals, type SignalEvent } from '../selfevolve/signalDetector.js'
import { resolveEvolveContext, type EvolveContext } from '../selfevolve/resolveEvolveContext.js'

const logger = createLogger('selfdrive')

// Active timers keyed by goal ID
const activeTimers = new Map<string, ReturnType<typeof setInterval>>()

// Signal detection timer (separate from goal timers)
let signalDetectionTimer: ReturnType<typeof setInterval> | null = null
const SIGNAL_DETECTION_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 hours

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
  'evolve': '[自驱] 全局自进化',
  'cleanup': '[自驱] 遗忘清理',
  'evolve-conversation': '[自驱] 对话体验自进化',
  'evolve-feature': '[自驱] 系统功能自进化',
}

const STATIC_PROMPTS: Record<string, string> = {
  'evolve': `执行一轮全局自进化周期：系统中的任何模块都可能成为改进对象。

分析范围（三个维度，选最有价值的方向）：

**1. 系统质量**
- 查看最近运行过的所有任务（成功和失败），从执行日志、耗时、节点输出中提取信号
- 审查各模块运行效果：workflow 引擎、memory 检索、scheduling 策略、错误处理等
- 识别重复出现的摩擦点、低效模式

**2. 对话与交互体验**
- 扫描最近任务的 conversation.jsonl / conversation.log，关注 AI 回复质量
- 检查回复是否冗长、偏题、格式不佳（如飞书 markdown 兼容性）
- 分析用户追问模式（连续追问暗示首次回答不满意）
- 检查各 persona 提示词的实际效果

**3. 功能缺口**
- 识别用户频繁手动重复的操作，评估自动化价值
- 检查高频需求模式，发现系统缺少的能力
- 优先选择可在单个 workflow 内完成的小型增强

改进目标可以是：
- 提示词优化（persona、workflow 生成、记忆提取、chat 回复格式等）
- 代码逻辑改进（错误处理、性能、健壮性）
- 配置调整（调度频率、阈值、超时等）
- 新能力补全

重要约束：
- 每轮只选择 2-3 个最高价值的改进，不要贪多
- 只实施低风险改进，排除涉及数据结构变更或核心引擎流程的修改
- 改进后必须运行 typecheck 验证，确保不引入回归
- 工作流必须简单：推荐 3 个节点（start → analyze-and-implement → end），最多 4 个节点（加一个 verify）
- 不要使用 review-fix 循环模式 — 自进化任务本身就是自检，不需要额外的审查循环
- 不要使用条件边 — 每个节点只有一个无条件出边，线性执行即可

生成改进方案并应用，记录进化历史。`,
  'cleanup': '执行数据清理：清理过期日志、孤儿文件、过时的记忆条目等。',
}

/** Get goal prompt with context awareness — CAH vs external project */
function getGoalPrompt(goalType: string, ctx: EvolveContext): string | undefined {
  // Static prompts (not context-aware)
  if (STATIC_PROMPTS[goalType]) return STATIC_PROMPTS[goalType]

  const projectLabel = ctx.projectName ? `项目 ${ctx.projectName}` : '当前项目'

  switch (goalType) {
    case 'evolve-conversation':
      return ctx.isCAH
        ? `分析 CAH 系统的对话体验质量并生成改进方案。

分析范围：
- 扫描最近任务的 conversation.jsonl / conversation.log，关注 AI 回复质量
- 检查回复是否冗长、偏题、格式不佳（如 markdown 在飞书卡片中不兼容）
- 分析用户追问模式 — 连续追问同一话题暗示首次回答不满意
- 检查各 persona 提示词的实际效果，与期望行为对比
- 关注飞书/Telegram 交互中的体验问题

改进方向：
- 优化 persona 提示词（更精准的角色定义、更好的回复格式指引）
- 改进 chat 回复风格（简洁度、准确度、格式适配）
- 调整交互流程中的摩擦点

约束：每轮最多改进 2 个提示词，改进后必须运行 typecheck 验证。`
        : `分析${projectLabel}的任务对话日志，优化 AI 协作体验。

分析范围：
- 扫描最近任务的 conversation.jsonl / conversation.log
- 关注 AI 回复是否准确完成了任务要求
- 分析任务成功率，识别回复质量与任务成功的关联
- 检查 workflow 生成策略是否适配该项目的特点

改进方向：
- 优化针对该项目的 workflow 生成策略
- 调整项目相关的 prompt 模板
- 改进任务描述到 workflow 的映射质量

约束：每轮最多 2 个改进，只实施低风险修改。`

    case 'evolve-feature':
      return ctx.isCAH
        ? `分析 CAH 系统的功能缺口，规划功能增强。

分析范围：
- 分析 CLI 命令使用频率和模式（从任务日志中提取 cah 命令调用）
- 识别用户经常手动重复的操作，评估自动化价值
- 检查 CLAUDE.md 中提到但尚未实现的功能
- 从任务描述中提取高频需求模式
- 审查最近的 GitHub issues 或 TODO 注释

改进方向：
- 识别 1-2 个高价值、低风险的功能增强点
- 生成具体的实现方案（包含文件变更清单）
- 优先选择可以在单个 workflow 内完成的小型增强

约束：
- 只选择低风险改进，排除核心引擎和数据结构变更
- 工作流节点数不超过 5 个
- 实施后运行 typecheck 和相关测试验证`
        : `分析${projectLabel}的任务模式，建议自动化改进。

分析范围：
- 分析该项目最近的任务描述和执行结果
- 识别重复出现的任务类型（可能适合模板化）
- 检查项目配置（.claude-agent-hub.yaml）中的优化空间
- 评估是否有手动操作可以通过 CAH 自动化

改进方向：
- 建议项目专属的任务模板
- 优化项目特定的 workflow 生成策略
- 提出配置调优建议

约束：每轮最多 2 个建议，只实施低风险修改。`

    default:
      return undefined
  }
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
    const ctx = resolveEvolveContext()
    const prompt = getGoalPrompt(goal.type, ctx) ?? description
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

// ============ Signal Detection ============

/** Run signal detection and trigger evolution for critical/warning signals */
async function runSignalDetection(): Promise<void> {
  try {
    const signals = detectSignals()
    const actionable = signals.filter(s => s.severity === 'critical' || s.severity === 'warning')

    if (actionable.length === 0) return

    logger.info(`Signal detection found ${actionable.length} actionable signal(s)`)

    // Check if there's already a signal-triggered evolution running
    if (hasRunningSelfdriveTask('signal-evolve')) {
      logger.info('Skipping signal-triggered evolution: one already running')
      return
    }

    // Pick highest severity signal (critical > warning)
    const signal = actionable.find(s => s.severity === 'critical') ?? actionable[0]!
    const label = `${signal.type} x${signal.count}`

    logger.info(`Triggering signal evolution: ${label}`)

    // Create a focused evolution task
    const task = createTaskWithFolder({
      title: `[信号触发] ${label}`,
      description: buildSignalEvolutionPrompt(signal),
      source: 'selfdrive',
      metadata: { goalType: 'signal-evolve', signalType: signal.type },
    })

    logger.info(`Created signal-triggered evolution task: ${task.id}`)
    spawnTaskRunner()
  } catch (error) {
    logger.error(`Signal detection failed: ${getErrorMessage(error)}`)
  }
}

function buildSignalEvolutionPrompt(signal: SignalEvent): string {
  return `执行一轮针对性自进化，聚焦于检测到的异常信号。

## 触发信号
- 类型: ${signal.type}
- 严重程度: ${signal.severity}
- 出现次数: ${signal.count}
- 模式: ${signal.pattern}
- 相关任务: ${signal.taskIds.join(', ')}

## 要求
1. 只分析上述相关任务的失败模式，不做全局扫描
2. 定位根因并生成针对性改进方案（1-2 个即可）
3. 只实施低风险改进，排除涉及数据结构变更的修改
4. 改进后运行 typecheck 验证
5. 记录进化历史，标明触发来源为信号检测`
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

  // Ensure deprecated goals are disabled before reading enabled list
  ensureBuiltinGoals()

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

  // Start signal detection: run once after 30s, then every 2 hours
  const initialDelay = setTimeout(() => {
    runSignalDetection().catch(err =>
      logger.error(`Initial signal detection error: ${getErrorMessage(err)}`)
    )
  }, 30_000)
  initialDelay.unref()

  signalDetectionTimer = setInterval(() => {
    runSignalDetection().catch(err =>
      logger.error(`Signal detection error: ${getErrorMessage(err)}`)
    )
  }, SIGNAL_DETECTION_INTERVAL_MS)
  signalDetectionTimer.unref()
  logger.info('Signal detection scheduled (first run in 30s, then every 2h)')
}

/** Stop all scheduled goals */
export function stopScheduler(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer)
    logger.debug(`Stopped goal timer: ${id}`)
  }
  activeTimers.clear()

  if (signalDetectionTimer) {
    clearInterval(signalDetectionTimer)
    signalDetectionTimer = null
    logger.debug('Stopped signal detection timer')
  }
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
