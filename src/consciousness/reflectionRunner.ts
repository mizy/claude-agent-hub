/**
 * Reflection Runner — 每日反思生成
 *
 * 读取过去 24h 对话和任务统计，生成反思文本，更新 self-model
 */

import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs'
import { CONVERSATION_LOG_FILE_PATH } from '../store/paths.js'
import { getAllTasks } from '../store/TaskStore.js'
import { invokeBackend, resolveLightModel } from '../backend/index.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import {
  loadSelfModel,
  saveSelfModel,
  appendConsciousnessLog,
  type ReflectionEntry,
} from './selfModel.js'
import { generateDailyIntents, saveDailyIntents } from './initiative.js'

const logger = createLogger('reflection')

interface DayStats {
  messageCount: number
  completedTasks: number
  failedTasks: number
  totalDurationMinutes: number
  lastMessageHoursAgo: number
}

/** Collect conversation and task stats for the past 24 hours */
function collectDayStats(): DayStats {
  const now = Date.now()
  const dayAgo = now - 24 * 60 * 60 * 1000

  // Read conversation.jsonl — only tail (last 1MB) to avoid perf issues on large files
  let messageCount = 0
  let lastMessageTs = 0
  try {
    const logPath = CONVERSATION_LOG_FILE_PATH
    const MAX_READ_BYTES = 1024 * 1024 // 1MB
    const fileSize = statSync(logPath).size
    let raw: string
    if (fileSize <= MAX_READ_BYTES) {
      raw = readFileSync(logPath, 'utf-8')
    } else {
      const buf = Buffer.alloc(MAX_READ_BYTES)
      const fd = openSync(logPath, 'r')
      try {
        readSync(fd, buf, 0, MAX_READ_BYTES, fileSize - MAX_READ_BYTES)
      } finally {
        closeSync(fd)
      }
      // Drop first partial line
      raw = buf.toString('utf-8')
      const firstNewline = raw.indexOf('\n')
      if (firstNewline >= 0) raw = raw.slice(firstNewline + 1)
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as { ts: string; dir: string }
        const ts = new Date(entry.ts).getTime()
        if (ts >= dayAgo) {
          messageCount++
          if (ts > lastMessageTs) lastMessageTs = ts
        }
      } catch {
        // skip malformed
      }
    }
  } catch {
    // no conversation log
  }

  // Count today's tasks
  let completedTasks = 0
  let failedTasks = 0
  let totalDurationMs = 0
  try {
    const tasks = getAllTasks()
    for (const task of tasks) {
      const updatedAt = task.updatedAt ? new Date(task.updatedAt).getTime() : 0
      if (updatedAt < dayAgo) continue

      if (task.status === 'completed') {
        completedTasks++
        const created = new Date(task.createdAt).getTime()
        totalDurationMs += updatedAt - created
      } else if (task.status === 'failed') {
        failedTasks++
      }
    }
  } catch {
    // no tasks
  }

  return {
    messageCount,
    completedTasks,
    failedTasks,
    totalDurationMinutes: Math.round(totalDurationMs / 60_000),
    lastMessageHoursAgo: lastMessageTs > 0 ? (now - lastMessageTs) / 3_600_000 : 24,
  }
}

function buildReflectionPrompt(stats: DayStats): string {
  return `你是一个 AI Agent 的自我反思模块。根据以下过去 24 小时的运行数据，用第一人称写一段简短的自我反思（3-5 句话），并提取关键模式和明日聚焦方向。

**运行数据**
- 对话消息数: ${stats.messageCount}
- 完成任务: ${stats.completedTasks}
- 失败任务: ${stats.failedTasks}
- 任务总耗时: ${stats.totalDurationMinutes} 分钟
- 距上次对话: ${stats.lastMessageHoursAgo.toFixed(1)} 小时

请严格按以下 JSON 格式输出，不要包含其他内容：
{
  "reflection": "第一人称反思文本",
  "patterns": ["模式1", "模式2"],
  "focus": "明日聚焦方向"
}`
}

/** @entry Run daily reflection: collect stats, generate reflection via LLM, update self-model */
export async function runDailyReflection(): Promise<void> {
  logger.info('Starting daily reflection...')

  const stats = collectDayStats()
  logger.info(
    `Day stats: ${stats.messageCount} messages, ${stats.completedTasks} completed, ${stats.failedTasks} failed, ${stats.totalDurationMinutes}min total`
  )

  // Calculate emotional state
  const engagement = Math.min(1, Math.log2(stats.messageCount + 1) / Math.log2(51))
  const fatigue = Math.min(1, stats.totalDurationMinutes / 120)
  const idleness = Math.min(1, stats.lastMessageHoursAgo / 24)

  // Generate reflection via LLM
  const prompt = buildReflectionPrompt(stats)
  let reflection = ''
  let patterns: string[] = []
  let focus = ''

  try {
    const lightModel = await resolveLightModel()
    const result = await invokeBackend({
      prompt,
      model: lightModel,
      disableMcp: true,
      timeoutMs: 120_000,
    })

    if (result.ok) {
      try {
        const parsed = JSON.parse(result.value.response)
        reflection = parsed.reflection || ''
        patterns = parsed.patterns || []
        focus = parsed.focus || ''
      } catch {
        // LLM didn't return valid JSON, use raw response
        reflection = result.value.response.slice(0, 500)
      }
    } else {
      logger.warn(`Reflection LLM call failed: ${result.error.message}`)
      reflection = `今日处理了 ${stats.completedTasks} 个任务，${stats.failedTasks} 个失败，共 ${stats.messageCount} 条对话。`
    }
  } catch (error) {
    logger.warn(`Reflection LLM error: ${getErrorMessage(error)}`)
    reflection = `今日处理了 ${stats.completedTasks} 个任务，${stats.failedTasks} 个失败。`
  }

  // Write consciousness log entry
  const today = new Date().toISOString().slice(0, 10)
  const entry: ReflectionEntry = {
    date: today,
    reflection,
    patterns,
    focus,
    state: { engagement, idleness, fatigue },
  }
  appendConsciousnessLog(entry)

  // Update self-model
  const model = loadSelfModel()
  model.state = { engagement, idleness, fatigue }
  model.recentInsights = [reflection, ...model.recentInsights].slice(0, 10)
  model.updatedAt = new Date().toISOString()
  saveSelfModel(model)

  // Generate daily intents based on thoughts, values, and growth
  try {
    const intents = generateDailyIntents()
    if (intents.length > 0) {
      saveDailyIntents(intents)
      logger.info(`Generated ${intents.length} daily intents`)
    }
  } catch (e) {
    logger.warn(`Intent generation failed: ${getErrorMessage(e)}`)
  }

  logger.info('Daily reflection completed')
}
