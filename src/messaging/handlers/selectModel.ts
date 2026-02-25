/**
 * Model selection — parse inline model keywords and auto-select model tier
 */

// Backends that understand Claude model names (opus/sonnet/haiku)
// CodeBuddy has its own model registry — passing Claude model names causes 400 errors
const CLAUDE_MODEL_BACKENDS = new Set(['claude-code'])

/** Check if a backend supports Claude model names for auto-selection */
export function isClaudeModelBackend(backendType?: string): boolean {
  if (!backendType) return false
  return CLAUDE_MODEL_BACKENDS.has(backendType)
}

/** Parse inline model keyword from message start (e.g. "@opus question" or "opus 帮我看看") */
export function parseInlineModel(text: string): { model?: string; actualText: string } {
  const pattern = /^@?(opus|sonnet|haiku)(?:\s|$)/i
  const match = text.match(pattern)
  if (!match) return { actualText: text }
  const model = match[1]!.toLowerCase()
  const actualText = text.slice(match[0].length).trim()
  return { model, actualText }
}

/** Keywords that signal deep reasoning requiring opus */
const OPUS_KEYWORDS =
  /(?:重构|refactor|架构|architect|迁移|migrate|设计|design|审查|review|分析|analyze|debug|调试|思考|think|深入|详细|detailed|复杂|complex|解释|explain|优化|optimize|比较|对比|compare|总结|summarize|推理|reason|elaborate)/i

/** Keywords for simple queries that haiku can handle */
const HAIKU_PATTERNS =
  /^(?:(?:你好|hi|hello|ping|status|状态|帮助|help|谢谢|thanks|ok|好的|收到|嗯)[!！？?。.]*|\/\w+.*)$/i

/** Pick model: override → haiku (trivial) → sonnet (default) → opus (complex) */
export function selectModel(
  text: string,
  ctx: { hasImages?: boolean; modelOverride?: string }
): string {
  if (ctx.modelOverride) return ctx.modelOverride
  if (ctx.hasImages) return 'opus'
  if (HAIKU_PATTERNS.test(text.trim())) return 'haiku'
  if (text.length > 150 || OPUS_KEYWORDS.test(text)) return 'opus'
  return 'sonnet'
}
