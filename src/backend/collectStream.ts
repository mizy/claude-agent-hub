/**
 * Shared stream collection for CLI backend adapters
 *
 * Handles: output guard, buffer management, line-by-line splitting.
 * Each backend provides a `processLine` callback for format-specific parsing.
 */

import type { ResultPromise } from 'execa'
import { createOutputGuard } from './outputGuard.js'

export interface CollectStreamOptions {
  /** Called for each complete line from stdout. Backend-specific parsing goes here. */
  processLine?: (line: string, onChunk?: (chunk: string) => void) => void
  /** Streaming callback forwarded from invoke options */
  onChunk?: (chunk: string) => void
  /** Performance tracking: records firstStdout timestamp */
  perf?: { firstStdout: number }
  startTime?: number
}

/**
 * Collect stdout from a subprocess with output guard protection.
 *
 * If `processLine` is provided, buffers text and splits into lines for processing.
 * Otherwise, passes raw chunks directly (suitable for plain-text backends like iflow).
 */
export async function collectStream(
  subprocess: ResultPromise,
  options: CollectStreamOptions = {}
): Promise<string> {
  const { processLine, onChunk, perf, startTime } = options
  const chunks: string[] = []
  const guard = createOutputGuard()
  let buffer = ''

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      const text = chunk.toString()

      if (perf && startTime && perf.firstStdout === 0) {
        perf.firstStdout = Date.now() - startTime
      }

      if (guard.push(text)) {
        chunks.push(text)
      }

      if (processLine) {
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          processLine(line, onChunk)
        }
      } else {
        // Raw passthrough — no JSON parsing needed
        if (onChunk) onChunk(text)
        else process.stdout.write(text)
      }
    }
  }

  await subprocess

  const output = chunks.join('')
  return guard.truncated
    ? output +
        `\n\n[OUTPUT TRUNCATED: exceeded limit, ${(guard.totalBytes / 1024 / 1024).toFixed(1)}MB total]`
    : output
}
