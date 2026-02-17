import type { FailedNodeInfo } from '../types/promptVersion.js'

export type FailureCategory =
  | 'planning'
  | 'execution'
  | 'validation'
  | 'resource'
  | 'prompt'
  | 'unknown'

export interface FailureClassification {
  category: FailureCategory
  confidence: number
  matchedPatterns: string[]
  raw: string
}

interface PatternRule {
  pattern: RegExp
  label: string
}

const categoryPatterns: Record<Exclude<FailureCategory, 'prompt' | 'unknown'>, PatternRule[]> = {
  planning: [
    { pattern: /json/i, label: 'json' },
    { pattern: /parse/i, label: 'parse' },
    { pattern: /workflow/i, label: 'workflow' },
    { pattern: /invalid.*response/i, label: 'invalid_response' },
    { pattern: /syntax\s*error/i, label: 'syntax_error' },
  ],
  execution: [
    { pattern: /timed?\s*out/i, label: 'timeout' },
    { pattern: /ETIMEDOUT/i, label: 'ETIMEDOUT' },
    { pattern: /command\s+not\s+found/i, label: 'command_not_found' },
    { pattern: /exit\s+code/i, label: 'exit_code' },
    { pattern: /ENOENT/i, label: 'ENOENT' },
    { pattern: /spawn\s+error/i, label: 'spawn_error' },
  ],
  validation: [
    { pattern: /\bTS\d+/i, label: 'ts_error' },
    { pattern: /typecheck/i, label: 'typecheck' },
    { pattern: /\btsc\b/i, label: 'tsc' },
    { pattern: /\bFAIL\b/, label: 'test_fail' },
    { pattern: /test.*fail/i, label: 'test_failure' },
    { pattern: /vitest/i, label: 'vitest' },
    { pattern: /jest/i, label: 'jest' },
    { pattern: /lint/i, label: 'lint' },
  ],
  resource: [
    { pattern: /ENOMEM/i, label: 'ENOMEM' },
    { pattern: /out\s+of\s+memory/i, label: 'out_of_memory' },
    { pattern: /heap/i, label: 'heap' },
    { pattern: /ENOSPC/i, label: 'ENOSPC' },
    { pattern: /no\s+space\s+left/i, label: 'no_space' },
    { pattern: /ECONNREFUSED/i, label: 'ECONNREFUSED' },
    { pattern: /ECONNRESET/i, label: 'ECONNRESET' },
    { pattern: /network/i, label: 'network' },
  ],
}

function computeConfidence(matchCount: number): number {
  if (matchCount === 0) return 0
  if (matchCount === 1) return 0.6
  if (matchCount === 2) return 0.8
  return 0.95
}

/** Rule-based failure classifier — fast pre-filter before LLM analysis */
export function classifyFailure(failedNodes: FailedNodeInfo[]): FailureClassification {
  if (failedNodes.length === 0) {
    return { category: 'unknown', confidence: 0, matchedPatterns: [], raw: '' }
  }

  const raw = failedNodes.map((n) => `[${n.nodeId}] ${n.error}`).join('\n')

  // Score each category by number of matched patterns
  let bestCategory: FailureCategory = 'unknown'
  let bestCount = 0
  let bestPatterns: string[] = []

  for (const [category, rules] of Object.entries(categoryPatterns)) {
    const matched: string[] = []
    for (const rule of rules) {
      if (rule.pattern.test(raw)) {
        matched.push(rule.label)
      }
    }
    if (matched.length > bestCount) {
      bestCount = matched.length
      bestCategory = category as FailureCategory
      bestPatterns = matched
    }
  }

  return {
    category: bestCategory,
    confidence: computeConfidence(bestCount),
    matchedPatterns: bestPatterns,
    raw,
  }
}
