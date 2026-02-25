/**
 * Chat benchmark — timing and performance measurement for chat responses
 */

export interface BenchmarkTiming {
  start: number
  promptReady: number
  parallelStart: number
  firstChunk: number
  backendDone: number
  responseSent: number
}

export function createBenchmark(): BenchmarkTiming {
  const now = Date.now()
  return {
    start: now,
    promptReady: 0,
    parallelStart: 0,
    firstChunk: 0,
    backendDone: 0,
    responseSent: 0,
  }
}

export function formatBenchmark(
  t: BenchmarkTiming,
  extra?: {
    slotWaitMs?: number
    apiMs?: number
    costUsd?: number
    model?: string
    backend?: string
  }
): string {
  const total = t.responseSent - t.start
  const prep = t.promptReady - t.start
  const parallel = t.parallelStart - t.promptReady
  const ttfc = t.firstChunk ? t.firstChunk - t.parallelStart : 0
  const inference = t.backendDone - t.parallelStart
  const send = t.responseSent - t.backendDone

  const modelLabel = extra?.model ? ` [${extra.model}]` : ''
  const backendLabel = extra?.backend ? ` (${extra.backend})` : ''
  const lines = [
    `**Benchmark** (${(total / 1000).toFixed(1)}s total)${modelLabel}${backendLabel}`,
    `- 准备阶段: ${prep}ms`,
    `- 并行启动: ${parallel}ms` + (extra?.slotWaitMs ? ` (含排队 ${extra.slotWaitMs}ms)` : ''),
    `- 首 chunk: ${ttfc}ms` + (ttfc > 0 ? '' : ' (无流式)'),
    `- 后端推理: ${(inference / 1000).toFixed(1)}s` +
      (extra?.apiMs ? ` (API: ${(extra.apiMs / 1000).toFixed(1)}s)` : ''),
    `- 发送回复: ${send}ms`,
  ]
  if (extra?.costUsd !== undefined) {
    lines.push(`- 费用: $${extra.costUsd.toFixed(4)}`)
  }
  return lines.join('\n')
}

let benchmarkEnabled = false

/** Toggle benchmark mode on/off */
export function toggleBenchmark(): boolean {
  benchmarkEnabled = !benchmarkEnabled
  return benchmarkEnabled
}

/** Check if benchmark is enabled */
export function isBenchmarkEnabled(): boolean {
  return benchmarkEnabled
}
