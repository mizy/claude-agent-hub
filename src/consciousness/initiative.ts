/**
 * Initiative engine — proactive intent generation
 *
 * Transforms active thoughts, value preferences, and growth records
 * into actionable intents. Low-risk intents can be auto-executed by
 * the self-drive system; high-risk ones await user approval.
 *
 * Storage: ~/.cah-data/consciousness/intents.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import { INTENTS_PATH } from '../store/paths.js'
import { getTopThoughts } from './activeThoughts.js'
import { getTopValues } from './valueSystem.js'
import { loadGrowthJournal } from './growthJournal.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('consciousness:initiative')

const MAX_PENDING_INTENTS = 10

// ============ Types ============

export interface Intent {
  id: string
  intent: string
  reasoning: string
  estimatedValue: 'high' | 'medium' | 'low'
  requiredApproval: boolean
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'rejected'
  createdAt: string
  resolvedAt?: string
  source: 'thoughts' | 'values' | 'inspiration'
}

// ============ Storage ============

function ensureDir(): void {
  mkdirSync(dirname(INTENTS_PATH), { recursive: true })
}

function readIntents(): Intent[] {
  try {
    const raw = readFileSync(INTENTS_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeIntents(intents: Intent[]): void {
  try {
    ensureDir()
    writeFileSync(INTENTS_PATH, JSON.stringify(intents, null, 2), 'utf-8')
  } catch (error) {
    logger.warn(`Failed to write intents: ${getErrorMessage(error)}`)
  }
}

// ============ Risk Classification ============

const LOW_RISK_PATTERNS = [
  /clean|清理|cleanup/i,
  /doc|文档|comment|注释/i,
  /config|配置|设置/i,
  /test|测试|spec/i,
  /lint|format|格式/i,
  /log|日志|monitor|监控/i,
  /typo|拼写/i,
]

const HIGH_RISK_PATTERNS = [
  /feat|功能|新增|实现/i,
  /refactor|重构|架构/i,
  /depend|依赖|upgrade|升级/i,
  /api|接口|schema/i,
  /delete|删除|remove|移除/i,
  /migrate|迁移/i,
]

/** Classify risk level of an intent — simple rule-based, no LLM needed */
export function classifyRisk(intentText: string): boolean {
  // Low-risk first: safe operations like tests/docs/cleanup can auto-execute
  if (LOW_RISK_PATTERNS.some(p => p.test(intentText))) return false
  // Then check high-risk: features/refactors/API changes need approval
  if (HIGH_RISK_PATTERNS.some(p => p.test(intentText))) return true
  // Default: require approval for unknown patterns
  return true
}

// ============ Intent Generation ============

const VALUE_DIMENSION_ACTIONS: Record<string, string[]> = {
  code_quality: ['清理未使用的 import 和变量', '补充缺失的类型注解', '统一命名风格'],
  stability: ['补充关键路径的错误处理', '增加边界条件测试', '检查未处理的 Promise'],
  performance: ['分析启动耗时并优化', '检查不必要的同步 I/O', '优化热路径的内存分配'],
  new_features: ['分析用户高频操作并简化流程', '评估缺失功能并提出 MVP 方案'],
  ux_polish: ['优化 CLI 输出的可读性', '统一错误提示格式', '改善帮助文档的示例'],
  autonomy: ['增强自检测能力', '优化自驱任务的决策逻辑', '改进失败自修复流程'],
}

/** Generate daily intents from three sources */
export function generateDailyIntents(): Intent[] {
  const now = new Date().toISOString()
  const generated: Intent[] = []

  // Source 1: Active thoughts (high priority, unresolved)
  try {
    const topThoughts = getTopThoughts(3)
    for (const thought of topThoughts) {
      if (thought.priority !== 'high') continue
      const intentText = `跟进想法: ${thought.thought}`
      const needsApproval = classifyRisk(intentText)
      generated.push({
        id: randomUUID(),
        intent: intentText,
        reasoning: `来自活跃想法池，优先级 high，来源: ${thought.source}`,
        estimatedValue: 'medium',
        requiredApproval: needsApproval,
        status: 'pending',
        createdAt: now,
        source: 'thoughts',
      })
    }
  } catch (e) {
    logger.debug(`Intent generation from thoughts failed: ${getErrorMessage(e)}`)
  }

  // Source 2: Value preferences (top dimension → improvement action)
  try {
    const topValues = getTopValues(2)
    for (const val of topValues) {
      const actions = VALUE_DIMENSION_ACTIONS[val.dimension]
      if (!actions?.length) continue
      // Pick a random action from the dimension's action list
      const action = actions[Math.floor(Math.random() * actions.length)] ?? ''
      const needsApproval = classifyRisk(action)
      generated.push({
        id: randomUUID(),
        intent: action,
        reasoning: `基于价值偏好 ${val.dimension}(权重 ${val.weight.toFixed(2)})`,
        estimatedValue: val.weight > 0.7 ? 'high' : 'medium',
        requiredApproval: needsApproval,
        status: 'pending',
        createdAt: now,
        source: 'values',
      })
    }
  } catch (e) {
    logger.debug(`Intent generation from values failed: ${getErrorMessage(e)}`)
  }

  // Source 3: Growth journal inspiration (recent growth → deepen direction)
  try {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const recentGrowth = loadGrowthJournal(weekAgo)
    if (recentGrowth.length > 0) {
      // Find most active change type this week
      const typeCounts: Record<string, number> = {}
      for (const entry of recentGrowth) {
        typeCounts[entry.changeType] = (typeCounts[entry.changeType] || 0) + 1
      }
      const topType = Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)[0]
      if (topType) {
        const [changeType, count] = topType
        const intentText = `深化本周 ${changeType} 方向的工作（本周已完成 ${count} 项）`
        generated.push({
          id: randomUUID(),
          intent: intentText,
          reasoning: `本周 ${changeType} 类型活跃度最高，可继续深化`,
          estimatedValue: 'low',
          requiredApproval: classifyRisk(intentText),
          status: 'pending',
          createdAt: now,
          source: 'inspiration',
        })
      }
    }
  } catch (e) {
    logger.debug(`Intent generation from growth failed: ${getErrorMessage(e)}`)
  }

  // Limit to 3-5 intents
  return generated.slice(0, 5)
}

// ============ CRUD Operations ============

/** Load all pending intents */
export function loadPendingIntents(): Intent[] {
  return readIntents().filter(i => i.status === 'pending')
}

/** Approve a pending intent */
export function approveIntent(id: string): boolean {
  const all = readIntents()
  const intent = all.find(i => i.id === id)
  if (!intent || intent.status !== 'pending') return false
  intent.status = 'approved'
  writeIntents(all)
  return true
}

/** Reject a pending intent */
export function rejectIntent(id: string): boolean {
  const all = readIntents()
  const intent = all.find(i => i.id === id)
  if (!intent || intent.status !== 'pending') return false
  intent.status = 'rejected'
  intent.resolvedAt = new Date().toISOString()
  writeIntents(all)
  return true
}

/** Mark an intent as completed */
export function completeIntent(id: string): boolean {
  const all = readIntents()
  const intent = all.find(i => i.id === id)
  if (!intent) return false
  intent.status = 'completed'
  intent.resolvedAt = new Date().toISOString()
  writeIntents(all)
  return true
}

/** Save newly generated intents, enforcing MAX_PENDING_INTENTS cap */
export function saveDailyIntents(newIntents: Intent[]): void {
  const all = readIntents()

  // Keep resolved intents (last 50), remove old ones
  const resolved = all.filter(i => i.resolvedAt)
    .sort((a, b) => new Date(b.resolvedAt!).getTime() - new Date(a.resolvedAt!).getTime())
    .slice(0, 50)

  // Merge existing pending with new
  const existingPending = all.filter(i => i.status === 'pending')
  const combined = [...existingPending, ...newIntents]

  // Cap pending intents by estimatedValue
  const valueOrder = { high: 0, medium: 1, low: 2 }
  const capped = combined
    .sort((a, b) => valueOrder[a.estimatedValue] - valueOrder[b.estimatedValue])
    .slice(0, MAX_PENDING_INTENTS)

  writeIntents([...capped, ...resolved])
  logger.info(`Saved ${newIntents.length} new intents (${capped.length} pending total)`)
}

/** Format pending intents for prompt injection */
export function formatPendingIntents(intents: Intent[]): string {
  if (intents.length === 0) return ''
  const lines = intents.map((it, i) => {
    const risk = it.requiredApproval ? '需审批' : '低风险'
    return `${i + 1}. [${risk}] ${it.intent}（${it.reasoning}）`
  })
  return `[当前意图]\n${lines.join('\n')}`
}
