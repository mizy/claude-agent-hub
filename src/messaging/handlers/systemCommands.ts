/**
 * System & utility commands — help/status/reload/cost/memory
 */

import { execSync, spawn } from 'child_process'
import { createLogger } from '../../shared/logger.js'
import {
  listMemories,
  addMemory,
  searchMemories,
} from '../../memory/index.js'
import {
  getDailyCost,
  getWeeklyCost,
  getMonthlyCost,
  type CostStats,
} from '../../store/conversationLog.js'
import { getAllTasks } from '../../task/queryTask.js'
import { getWaitingHumanJobs } from '../../workflow/index.js'
import { isServiceRunning } from '../../scheduler/pidLock.js'
import { formatDuration } from '../../shared/formatTime.js'
import {
  buildHelpCard,
  buildCard,
  mdElement,
  hrElement,
  noteElement,
} from '../buildLarkCard.js'
import type { CommandResult } from './types.js'

const logger = createLogger('command-handler')

export function handleHelp(): CommandResult {
  return {
    text: [
      '🤖 Claude Agent Hub 指令:',
      '',
      '📋 任务管理:',
      '/run <描述> - 创建并执行任务',
      '/list [status] - 查看任务列表',
      '/get <id> - 查看任务详情',
      '/logs <id> - 查看任务日志',
      '/stop <id> - 停止任务',
      '/resume <id> - 恢复任务',
      '/pause <id> [原因] - 暂停任务',
      '/msg <id> <消息> - 向任务发送消息',
      '/snapshot <id> - 查看任务快照',
      '',
      '✅ 审批:',
      '/approve [nodeId] - 批准节点',
      '/reject [原因] - 拒绝节点',
      '/status - 查看待审批节点',
      '',
      '💬 对话:',
      '/new - 开始新对话',
      '/compact - 压缩 context（保存记忆后开新会话）',
      '/chat - 查看对话状态',
      '/model [opus|sonnet|haiku|auto] - 切换模型',
      '/help - 显示此帮助',
      '',
      '🧠 记忆:',
      '/memory list - 查看记忆列表',
      '/memory add <内容> - 添加记忆',
      '/memory search <关键词> - 搜索记忆',
      '',
      '💰 统计:',
      '/cost - 查看对话费用统计',
      '',
      '🤖 自管理:',
      '/self check - 健康检查',
      '/self evolve - 自我进化',
      '/self drive start/stop/status - 自驱模式',
      '/self status - 综合状态',
      '',
      '🔧 系统:',
      '/reload - 重启守护进程（加载新代码）',
      '',
      '💡 直接发送文字即可与 AI 对话',
      '💡 taskId 支持前缀匹配',
    ].join('\n'),
    larkCard: buildHelpCard(),
  }
}

export function handleStatus(): CommandResult {
  const tasks = getAllTasks()
  const { running: daemonRunning, lock: daemonLock } = isServiceRunning('daemon')

  const runningTasks = tasks.filter((t) => t.status === 'developing' || t.status === 'planning')
  const pending = tasks.filter((t) => t.status === 'pending')
  const paused = tasks.filter((t) => t.status === 'paused')
  const completed = tasks.filter((t) => t.status === 'completed')
  const failed = tasks.filter((t) => t.status === 'failed')
  const jobs = getWaitingHumanJobs()

  // Calculate today's tasks and success rate
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayTasks = tasks.filter((t) => new Date(t.createdAt) >= todayStart)
  const successRate = completed.length + failed.length > 0
    ? Math.round((completed.length / (completed.length + failed.length)) * 100)
    : 0

  const lines = ['🔧 **CAH 系统状态**', '']

  // Daemon status
  lines.push('**守护进程**')
  if (daemonRunning && daemonLock) {
    const uptimeMs = Date.now() - new Date(daemonLock.startedAt).getTime()
    const uptimeStr = formatDuration(uptimeMs)
    const memMB = getProcessMemoryMB(daemonLock.pid)
    const memStr = memMB ? ` | ${memMB}MB` : ''
    lines.push(`✅ 运行中 (PID ${daemonLock.pid}) | 运行 ${uptimeStr}${memStr}`)
  } else {
    lines.push('❌ 未运行')
  }
  lines.push('')

  // Task statistics
  lines.push('**任务统计**')
  lines.push(`总计: ${tasks.length} | 运行: ${runningTasks.length} | 待处理: ${pending.length}`)
  lines.push(`完成: ${completed.length} | 失败: ${failed.length} | 暂停: ${paused.length}`)
  lines.push(`今日: ${todayTasks.length} | 成功率: ${successRate}%`)
  lines.push('')

  // Queue status
  if (pending.length > 0 || runningTasks.length > 0) {
    lines.push('**队列状态**')
    lines.push(`等待: ${pending.length} | 活跃: ${runningTasks.length}`)
    lines.push('')
  }

  // Waiting approval
  if (jobs.length > 0) {
    lines.push(`**待审批**: ${jobs.length} 个节点`)
    for (const job of jobs.slice(0, 2)) {
      lines.push(`  • \`${job.data.nodeId}\``)
    }
    if (jobs.length > 2) lines.push(`  ... 还有 ${jobs.length - 2} 个`)
    lines.push('')
  }

  // Recent activity (last 3 tasks)
  const recent = [...tasks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3)

  if (recent.length > 0) {
    lines.push('**近期活动**')
    for (const t of recent) {
      const emoji = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⏳'
      const title = t.title.length > 25 ? t.title.slice(0, 22) + '...' : t.title
      const createdAt = new Date(t.createdAt)
      const agoMs = Date.now() - createdAt.getTime()
      const agoStr = agoMs < 3600000 ? `${Math.round(agoMs / 60000)}分钟前` :
                     agoMs < 86400000 ? `${Math.round(agoMs / 3600000)}小时前` :
                     `${Math.round(agoMs / 86400000)}天前`
      lines.push(`${emoji} ${title} (${agoStr})`)
    }
    lines.push('')
  }

  lines.push('💡 /list 查看完整列表 | /help 查看所有命令')

  // Build Lark card
  const daemonStatusText = daemonRunning && daemonLock
    ? `✅ **守护进程**: 运行中 (PID ${daemonLock.pid})`
    : '❌ **守护进程**: 未运行'

  const cardElements = [
    mdElement([
      daemonStatusText,
      '',
      `**任务**: ${tasks.length} 总计 | ${runningTasks.length} 运行中 | ${pending.length} 待处理`,
      `**今日**: ${todayTasks.length} 个任务 | 成功率 ${successRate}%`,
      jobs.length > 0 ? `**待审批**: ${jobs.length} 个节点` : '',
    ].filter(Boolean).join('\n')),
  ]

  if (recent.length > 0) {
    cardElements.push(hrElement())
    cardElements.push(mdElement('**近期活动**\n' + recent.map((t) => {
      const emoji = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⏳'
      const title = t.title.length > 25 ? t.title.slice(0, 22) + '...' : t.title
      return `${emoji} ${title}`
    }).join('\n')))
  }

  cardElements.push(noteElement('💡 使用 /list 查看完整任务列表'))

  return {
    text: lines.join('\n'),
    larkCard: buildCard('🔧 CAH 系统状态', 'blue', cardElements),
  }
}

/** Get process RSS memory in MB (returns null if process not accessible) */
function getProcessMemoryMB(pid: number): string | null {
  try {
    const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf-8' }).trim()
    const kb = parseInt(output, 10)
    if (isNaN(kb)) return null
    return String(Math.round(kb / 1024))
  } catch {
    return null
  }
}

export function handleMemory(args: string): CommandResult {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0] || 'list'
  const rest = parts.slice(1).join(' ')

  switch (subcommand) {
    case 'list': {
      const memories = listMemories()
      if (memories.length === 0) {
        return { text: '暂无记忆' }
      }

      const categoryLabel: Record<string, string> = {
        pattern: '模式', lesson: '经验', preference: '偏好', pitfall: '陷阱', tool: '工具',
      }

      const recent = memories.slice(0, 10)
      const lines = [`🧠 记忆列表 (${memories.length})`, '']
      for (const m of recent) {
        const cat = categoryLabel[m.category] || m.category
        const content = m.content.length > 60 ? m.content.slice(0, 57) + '...' : m.content
        lines.push(`[${cat}] ${content}`)
      }
      if (memories.length > 10) {
        lines.push('', `还有 ${memories.length - 10} 条记忆未显示`)
      }
      return { text: lines.join('\n') }
    }
    case 'add': {
      if (!rest.trim()) {
        return { text: '用法: /memory add <记忆内容>' }
      }
      const entry = addMemory(rest.trim(), 'lesson', { type: 'chat' })
      return { text: `✅ 记忆已添加\nID: ${entry.id}` }
    }
    case 'search': {
      if (!rest.trim()) {
        return { text: '用法: /memory search <关键词>' }
      }
      const results = searchMemories(rest.trim())
      if (results.length === 0) {
        return { text: `未找到匹配 "${rest.trim()}" 的记忆` }
      }

      const lines = [`🔍 搜索结果 (${results.length})`, '']
      for (const m of results.slice(0, 10)) {
        const content = m.content.length > 60 ? m.content.slice(0, 57) + '...' : m.content
        lines.push(`• ${content}`)
      }
      return { text: lines.join('\n') }
    }
    default:
      return { text: '用法: /memory list | /memory add <内容> | /memory search <关键词>' }
  }
}

function formatCostLine(label: string, stats: CostStats): string {
  if (stats.messageCount === 0) return `${label}: $0.00 (0 条)`
  return `${label}: $${stats.totalUsd.toFixed(2)} (${stats.messageCount} 条)`
}

function formatModelBreakdown(stats: CostStats): string {
  const entries = Object.entries(stats.byModel).sort((a, b) => b[1].costUsd - a[1].costUsd)
  if (entries.length === 0) return '暂无数据'
  return entries
    .map(([model, { count, costUsd }]) => `  ${model}: $${costUsd.toFixed(2)} (${count} 条)`)
    .join('\n')
}

export function handleCost(): CommandResult {
  const daily = getDailyCost()
  const weekly = getWeeklyCost()
  const monthly = getMonthlyCost()

  const lines = [
    '💰 对话费用统计',
    '',
    formatCostLine('今日', daily),
    formatCostLine('本周', weekly),
    formatCostLine('本月', monthly),
  ]

  // Model breakdown for monthly (most useful view)
  if (monthly.messageCount > 0) {
    lines.push('', '本月模型分布:')
    lines.push(formatModelBreakdown(monthly))
  }

  // Build Lark card
  const cardElements = [
    mdElement([
      `**今日**: $${daily.totalUsd.toFixed(2)} (${daily.messageCount} 条)`,
      `**本周**: $${weekly.totalUsd.toFixed(2)} (${weekly.messageCount} 条)`,
      `**本月**: $${monthly.totalUsd.toFixed(2)} (${monthly.messageCount} 条)`,
    ].join('\n')),
  ]

  if (monthly.messageCount > 0) {
    const modelLines = Object.entries(monthly.byModel)
      .sort((a, b) => b[1].costUsd - a[1].costUsd)
      .map(([model, { count, costUsd }]) => {
        const pct = monthly.totalUsd > 0 ? ((costUsd / monthly.totalUsd) * 100).toFixed(0) : '0'
        return `**${model}**: $${costUsd.toFixed(2)} (${count} 条, ${pct}%)`
      })
    cardElements.push(hrElement())
    cardElements.push(mdElement('**本月模型分布**\n' + modelLines.join('\n')))
  }

  cardElements.push(noteElement('数据来源: conversation.jsonl'))

  return {
    text: lines.join('\n'),
    larkCard: buildCard('💰 对话费用', 'blue', cardElements),
  }
}

// Debounce: reject /reload if one was initiated within this window
// Init to Date.now() so newly restarted daemon won't re-trigger from Lark message re-delivery
const RELOAD_DEBOUNCE_MS = 10_000
let lastReloadAt = Date.now()

export function handleReload(): CommandResult {
  const now = Date.now()
  const elapsed = now - lastReloadAt
  if (elapsed < RELOAD_DEBOUNCE_MS) {
    const remaining = Math.ceil((RELOAD_DEBOUNCE_MS - elapsed) / 1000)
    logger.info(`→ reload debounced (${remaining}s remaining)`)
    return {
      text: `⏳ 重启已在进行中，请等待 ${remaining} 秒后再试`,
    }
  }
  lastReloadAt = now

  // 通过 spawn 子进程执行 cah restart，避免阻塞当前消息回复
  const child = spawn(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1, 2), 'restart'],
    {
      detached: true,
      stdio: 'ignore',
    }
  )
  child.unref()

  logger.info('→ reload initiated via child process')
  return {
    text: [
      '🔄 正在重启守护进程...',
      '',
      '约 2 秒后生效，期间消息可能延迟',
      '',
      '💡 使用 /status 确认重启完成',
    ].join('\n'),
  }
}
