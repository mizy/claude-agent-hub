/**
 * Text tokenization and similarity utilities for memory dedup/consolidation
 */

/** CJK character range test */
export function isCJK(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
}

/** Tokenize text into words (space-split for Latin) + 2-gram for CJK */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  const lower = text.toLowerCase()
  for (const w of lower.split(/\s+/)) {
    if (w.length >= 2) tokens.add(w)
  }
  for (let i = 0; i < lower.length - 1; i++) {
    if (isCJK(lower[i]!) && isCJK(lower[i + 1]!)) {
      tokens.add(lower[i]! + lower[i + 1]!)
    }
  }
  return tokens
}

/** Token-based content similarity (Jaccard-like: intersection / max(|A|, |B|)) */
export function contentSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let overlap = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++
  }
  return overlap / Math.max(tokensA.size, tokensB.size)
}
