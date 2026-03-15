/**
 * Build consciousness injection block with per-module budgets
 *
 * Extracted from chatPromptBuilder.ts to keep files under 500 lines.
 * Each module is independently try-caught so failures are isolated.
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import {
  getRecentEntries, formatForPrompt, loadSelfModel, loadInnerState, formatInnerStateForPrompt,
  getTopValues, formatValuePreferences, getGrowthSummary, readConsciousnessLogs,
  generateForesight,
} from '../../consciousness/index.js'
import { getTopThoughts, formatActiveThoughts } from '../../consciousness/activeThoughts.js'
import { loadPendingIntents, formatPendingIntents } from '../../consciousness/initiative.js'

const logger = createLogger('consciousness-block')

/** Per-module consciousness budget (chars) to avoid post-concat blind truncation */
export const CONSCIOUSNESS_BUDGET = {
  stream: 400,       // session-end insights
  innerState: 500,   // active sessions + recent events (injected every turn)
  thoughts: 350,     // active thoughts pool
  intents: 350,      // pending intents
  selfModel: 400,    // state + narrative + insights
  values: 100,       // top value preferences (injected every turn)
  growth: 150,       // recent growth summary (new session only)
  reflection: 200,   // recent reflection (new session only)
  foresight: 150,    // recurring theme predictions (new session only)
} as const

/** Total budget: new session gets more room, resumed session stays lean */
const MAX_CONSCIOUSNESS_NEW_SESSION = 2500
const MAX_CONSCIOUSNESS_RESUMED = 800

/** Truncate text to budget, appending ellipsis if truncated */
function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text
  return text.slice(0, budget) + '\n…'
}

export interface ConsciousnessBlockOptions {
  chatId: string
  willStartNewSession: boolean
  cachedInnerState?: ReturnType<typeof loadInnerState>
  lastInjectedAt: Map<string, number>
}

/**
 * Build the full consciousness injection string.
 * Returns the concatenated consciousness block ready for prompt assembly.
 */
export function buildConsciousnessBlock(opts: ConsciousnessBlockOptions): string {
  const { chatId, willStartNewSession, cachedInnerState, lastInjectedAt } = opts
  const tag = chatId.slice(0, 8)

  // Consciousness stream: session-end insights (new session only)
  let consciousnessRaw = ''
  if (willStartNewSession) {
    try {
      const allEntries = getRecentEntries(10)
      const sessionEndEntries = allEntries.filter(e => e.type === 'session_end').slice(-3)
      const otherEntries = allEntries
        .filter(e => e.type !== 'session_end' && e.type !== 'task_event')
        .slice(-5)
      const combined = [...sessionEndEntries, ...otherEntries]
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      const formatted = formatForPrompt(combined)
      if (formatted) {
        consciousnessRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.stream) + '\n\n'
        logger.debug(`injected consciousness context (${sessionEndEntries.length} session-end + ${otherEntries.length} other) [${tag}]`)
      }
    } catch (e) {
      logger.debug(`consciousness retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // InnerState: active sessions + recent events — injected every turn
  let innerStateRaw = ''
  try {
    const state = cachedInnerState ?? loadInnerState()
    const formatted = formatInnerStateForPrompt(state)
    if (formatted) {
      innerStateRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.innerState) + '\n\n'
      logger.debug(`injected inner state context [${tag}]`)
    }
  } catch (e) {
    logger.debug(`inner state retrieval failed: ${getErrorMessage(e)}`)
  }

  // Active thoughts: new session = full; resume = only new since last injection
  let activeThoughtsRaw = ''
  if (willStartNewSession) {
    try {
      const topThoughts = getTopThoughts(3)
      const formatted = formatActiveThoughts(topThoughts)
      if (formatted) {
        activeThoughtsRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.thoughts) + '\n\n'
        logger.debug(`injected ${topThoughts.length} active thoughts [${tag}]`)
      }
    } catch (e) {
      logger.debug(`active thoughts retrieval failed: ${getErrorMessage(e)}`)
    }
  } else {
    try {
      const prevTs = lastInjectedAt.get(opts.chatId) ?? 0
      if (prevTs > 0) {
        const topThoughts = getTopThoughts(5)
        const newThoughts = topThoughts.filter(t => new Date(t.createdAt).getTime() > prevTs)
        if (newThoughts.length > 0) {
          const formatted = formatActiveThoughts(newThoughts)
          if (formatted) {
            activeThoughtsRaw = truncateToBudget(`[新增思考]\n${formatted}`, CONSCIOUSNESS_BUDGET.thoughts) + '\n\n'
            logger.debug(`resume: injected ${newThoughts.length} new thoughts [${tag}]`)
          }
        }
      }
    } catch (e) {
      logger.debug(`resume thoughts retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Pending intents: new session only
  let intentsRaw = ''
  if (willStartNewSession) {
    try {
      const pending = loadPendingIntents().slice(0, 5)
      const formatted = formatPendingIntents(pending)
      if (formatted) {
        intentsRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.intents) + '\n\n'
        logger.debug(`injected ${pending.length} pending intents [${tag}]`)
      }
    } catch (e) {
      logger.debug(`intent retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Self-model: new session = full; resume = diff since last injection
  let selfModelRaw = ''
  if (willStartNewSession) {
    try {
      const model = loadSelfModel()
      if (model) {
        const lines: string[] = []
        const { state, narrative, recentInsights } = model
        if (state?.fatigue > 0.7) lines.push('[当前状态] 近期任务密集，回复可简短')
        else if (state?.engagement > 0.7) lines.push('[当前状态] 对话活跃，主动参与')
        if (state?.idleness > 0.7) lines.push('[当前状态] 久未收到任务，可主动建议')
        if (narrative) lines.push(`[自我认知] ${narrative}`)
        if (recentInsights?.length) {
          const items = recentInsights.slice(0, 3).map(s => `- ${s}`).join('\n')
          lines.push(`[近期洞察]\n${items}`)
        }
        if (lines.length) {
          selfModelRaw = truncateToBudget(lines.join('\n'), CONSCIOUSNESS_BUDGET.selfModel) + '\n\n'
          logger.debug(`injected self-model context (${lines.length} lines) [${tag}]`)
        }
      }
    } catch (e) {
      logger.debug(`self-model retrieval failed: ${getErrorMessage(e)}`)
    }
  } else {
    try {
      const prevTs = lastInjectedAt.get(opts.chatId) ?? 0
      if (prevTs > 0) {
        const model = loadSelfModel()
        if (model && new Date(model.updatedAt).getTime() > prevTs) {
          const lines: string[] = []
          if (model.recentInsights?.length) {
            const items = model.recentInsights.slice(0, 2).map(s => `- ${s}`).join('\n')
            lines.push(`[新增洞察]\n${items}`)
          }
          const { state } = model
          if (state?.fatigue > 0.7) lines.push('[状态变化] 近期任务密集')
          else if (state?.engagement > 0.7) lines.push('[状态变化] 对话活跃')
          if (lines.length) {
            selfModelRaw = truncateToBudget(lines.join('\n'), CONSCIOUSNESS_BUDGET.selfModel) + '\n\n'
            logger.debug(`resume: injected selfModel diff (${lines.length} lines) [${tag}]`)
          }
        }
      }
    } catch (e) {
      logger.debug(`resume selfModel retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Value preferences: top-3 dimensions (every turn — lightweight)
  let valuesRaw = ''
  try {
    const topValues = getTopValues(3)
    const formatted = formatValuePreferences(topValues)
    if (formatted) {
      valuesRaw = truncateToBudget(formatted, CONSCIOUSNESS_BUDGET.values) + '\n\n'
      logger.debug(`injected value preferences (${topValues.length} dims) [${tag}]`)
    }
  } catch (e) {
    logger.debug(`value preferences retrieval failed: ${getErrorMessage(e)}`)
  }

  // Growth summary: recent week stats (new session only)
  let growthRaw = ''
  if (willStartNewSession) {
    try {
      const summary = getGrowthSummary('week')
      if (summary.totalEntries > 0) {
        const parts = Object.entries(summary.byType)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}:${v}`)
        growthRaw = truncateToBudget(
          `[最近成长] 本周 ${summary.totalEntries} 项记录（${parts.join(' ')})`,
          CONSCIOUSNESS_BUDGET.growth,
        ) + '\n\n'
        logger.debug(`injected growth summary (${summary.totalEntries} entries) [${tag}]`)
      }
    } catch (e) {
      logger.debug(`growth summary retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Recent reflection: latest 1 entry (new session only)
  let reflectionRaw = ''
  if (willStartNewSession) {
    try {
      const logs = readConsciousnessLogs(7)
      const latest = logs[logs.length - 1]
      if (latest) {
        const text = latest.reflection.length > CONSCIOUSNESS_BUDGET.reflection - 20
          ? latest.reflection.slice(0, CONSCIOUSNESS_BUDGET.reflection - 20) + '…'
          : latest.reflection
        reflectionRaw = `[最近反思] ${text}\n\n`
        logger.debug(`injected recent reflection (${latest.date}) [${tag}]`)
      }
    } catch (e) {
      logger.debug(`reflection retrieval failed: ${getErrorMessage(e)}`)
    }
  }

  // Foresight: recurring theme predictions (new session only)
  let foresightRaw = ''
  if (willStartNewSession) {
    try {
      const foresight = generateForesight()
      if (foresight) {
        foresightRaw = truncateToBudget(foresight, CONSCIOUSNESS_BUDGET.foresight) + '\n\n'
        logger.debug(`injected foresight [${tag}]`)
      }
    } catch (e) {
      logger.debug(`foresight generation failed: ${getErrorMessage(e)}`)
    }
  }

  // Enforce total consciousness budget — trim low-priority modules first
  const MAX_TOTAL = willStartNewSession ? MAX_CONSCIOUSNESS_NEW_SESSION : MAX_CONSCIOUSNESS_RESUMED
  const calcTotal = () =>
    consciousnessRaw.length + innerStateRaw.length + activeThoughtsRaw.length +
    intentsRaw.length + selfModelRaw.length + valuesRaw.length + growthRaw.length + reflectionRaw.length + foresightRaw.length
  if (calcTotal() > MAX_TOTAL) {
    const modules = [
      { name: 'intents', get: () => intentsRaw, set: (v: string) => { intentsRaw = v } },
      { name: 'thoughts', get: () => activeThoughtsRaw, set: (v: string) => { activeThoughtsRaw = v } },
      { name: 'foresight', get: () => foresightRaw, set: (v: string) => { foresightRaw = v } },
      { name: 'reflection', get: () => reflectionRaw, set: (v: string) => { reflectionRaw = v } },
      { name: 'growth', get: () => growthRaw, set: (v: string) => { growthRaw = v } },
      { name: 'stream', get: () => consciousnessRaw, set: (v: string) => { consciousnessRaw = v } },
    ]
    for (const mod of modules) {
      const t = calcTotal()
      if (t <= MAX_TOTAL) break
      const excess = t - MAX_TOTAL
      const current = mod.get()
      if (!current) continue
      if (current.length <= excess) {
        mod.set('')
        logger.debug(`consciousness budget: dropped ${mod.name} (${current.length} chars)`)
      } else {
        mod.set(current.slice(0, current.length - excess) + '\n…')
        logger.debug(`consciousness budget: trimmed ${mod.name} by ${excess} chars`)
      }
    }
  }

  return consciousnessRaw + innerStateRaw + activeThoughtsRaw + intentsRaw + selfModelRaw + valuesRaw + growthRaw + reflectionRaw + foresightRaw
}
