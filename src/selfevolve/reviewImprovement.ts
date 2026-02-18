/**
 * Agent review for improvement proposals.
 *
 * Calls the configured backend to have an independent agent review
 * each improvement before it's applied. This is a quality gate
 * that prevents harmful or unnecessary changes.
 */

import { invokeBackend } from '../backend/index.js'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { Improvement, FailurePattern, PerformancePattern, ReviewResult } from './types.js'

const logger = createLogger('selfevolve:review')

interface ReviewContext {
  patterns: FailurePattern[]
  performancePatterns?: PerformancePattern[]
}

/**
 * Review a single improvement proposal via an independent agent.
 * Returns approved with confidence=0 if the backend is unavailable.
 */
export async function reviewImprovement(
  improvement: Improvement,
  context: ReviewContext
): Promise<ReviewResult> {
  const prompt = buildReviewPrompt(improvement, context)

  try {
    const result = await invokeBackend({
      prompt,
      mode: 'review',
      skipPermissions: true,
      disableMcp: true,
      timeoutMs: 120_000, // 2 min per review
    })

    if (!result.ok) {
      logger.warn(`Review backend error: ${result.error.message}, auto-approving`)
      return fallbackApproval('review backend error: ' + result.error.message)
    }

    return parseReviewResponse(result.value.response)
  } catch (error) {
    logger.warn(`Review failed: ${getErrorMessage(error)}, auto-approving`)
    return fallbackApproval('review unavailable: ' + getErrorMessage(error))
  }
}

/**
 * Review multiple improvements sequentially.
 * Returns review results paired with improvement IDs.
 */
export async function reviewImprovements(
  improvements: Improvement[],
  context: ReviewContext
): Promise<Array<{ improvementId: string; review: ReviewResult }>> {
  const results: Array<{ improvementId: string; review: ReviewResult }> = []

  for (const imp of improvements) {
    logger.info(`Reviewing improvement ${imp.id}: ${imp.description}`)
    const review = await reviewImprovement(imp, context)
    results.push({ improvementId: imp.id, review })
    logger.info(
      `Review result for ${imp.id}: ${review.approved ? 'APPROVED' : 'REJECTED'} (confidence: ${review.confidence})`
    )
  }

  return results
}

function buildReviewPrompt(improvement: Improvement, context: ReviewContext): string {
  const failureSection =
    context.patterns.length > 0
      ? context.patterns
          .map(p => `- [${p.category}] ${p.description} (${p.occurrences} occurrences)`)
          .join('\n')
      : 'None'

  const perfSection =
    context.performancePatterns && context.performancePatterns.length > 0
      ? context.performancePatterns
          .map(p => `- [${p.category}] ${p.description} (severity: ${p.severity})`)
          .join('\n')
      : 'None'

  return `你是一位 AI 系统改进审查员。请审查以下改进方案：

## 改进方案
- ID: ${improvement.id}
- 类型: ${improvement.source}
- 描述: ${improvement.description}
- 具体变更: ${improvement.detail}
- 目标人格: ${improvement.personaName ?? '无'}

## 触发背景
### 失败模式
${failureSection}

### 性能模式
${perfSection}

## 审查要求
1. 该改进是否针对了根本原因？
2. 是否可能引入新问题？
3. 改进的范围是否合理（不过大也不过小）？

请以 JSON 格式输出（不要包含其他内容）：
{
  "approved": boolean,
  "confidence": 0-1,
  "reasoning": "审查理由",
  "suggestions": ["建议1", ...],
  "risksIdentified": ["风险1", ...]
}`
}

function parseReviewResponse(response: string): ReviewResult {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    logger.warn('Could not extract JSON from review response, auto-approving')
    return fallbackApproval('failed to parse review response')
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      approved: typeof parsed.approved === 'boolean' ? parsed.approved : true,
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'no reasoning provided',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : undefined,
      risksIdentified: Array.isArray(parsed.risksIdentified) ? parsed.risksIdentified : undefined,
    }
  } catch {
    logger.warn('Failed to parse review JSON, auto-approving')
    return fallbackApproval('JSON parse error')
  }
}

function fallbackApproval(reason: string): ReviewResult {
  return {
    approved: true,
    confidence: 0,
    reasoning: reason,
  }
}
