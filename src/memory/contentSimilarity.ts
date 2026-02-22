/**
 * Word-set overlap ratio for content deduplication.
 * Shared between memory write (manageMemory) and read (formatMemory) paths.
 */

/** Simple word-set overlap ratio — returns 0..1 */
export function contentSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length >= 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length >= 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }
  return overlap / Math.max(wordsA.size, wordsB.size)
}
