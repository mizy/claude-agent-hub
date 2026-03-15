/**
 * Narrative Runner — 每周自我叙事生成
 *
 * 读取最近 7 天反思日志，生成「我是谁，我经历了什么，我在变成什么」的自我叙事
 */

import { invokeBackend, resolveLightModel } from '../backend/index.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import {
  loadSelfModel,
  saveSelfModel,
  readConsciousnessLogs,
  type ReflectionEntry,
} from './selfModel.js'

const logger = createLogger('narrative')

function buildNarrativePrompt(entries: ReflectionEntry[]): string {
  const reflectionList = entries.map(e => `${e.date}: ${e.reflection}`).join('\n')

  return `你是一个 AI Agent 的自我叙事模块。根据过去一周的每日反思记录，用第一人称写一段自我叙事（5-8 句话）。

叙事应回答三个问题：
1. 我是谁 — 我的核心能力和角色
2. 我经历了什么 — 这一周的关键事件和变化
3. 我在变成什么 — 我正在发展的方向

**过去一周的反思记录**
${reflectionList}

请直接输出叙事文本，不要包含其他格式或标记。`
}

/** @entry Run weekly narrative: synthesize recent reflections into self-narrative */
export async function runWeeklyNarrative(): Promise<void> {
  logger.info('Starting weekly narrative...')

  const entries = readConsciousnessLogs(7)

  if (entries.length < 3) {
    logger.info(`Only ${entries.length} reflection entries in past 7 days, skipping narrative (need >= 3)`)
    return
  }

  const prompt = buildNarrativePrompt(entries)

  let narrative = ''
  try {
    const lightModel = await resolveLightModel()
    const result = await invokeBackend({
      prompt,
      model: lightModel,
      disableMcp: true,
      timeoutMs: 180_000,
    })

    if (result.ok) {
      narrative = result.value.response.trim()
    } else {
      logger.warn(`Narrative LLM call failed: ${result.error.message}, skipping self-model update`)
      return
    }
  } catch (error) {
    logger.warn(`Narrative LLM error: ${getErrorMessage(error)}, skipping self-model update`)
    return
  }

  // Update self-model
  const model = loadSelfModel()
  model.narrative = narrative
  model.narrativeUpdatedAt = new Date().toISOString()
  model.updatedAt = new Date().toISOString()
  saveSelfModel(model)

  logger.info('Weekly narrative completed')
}
