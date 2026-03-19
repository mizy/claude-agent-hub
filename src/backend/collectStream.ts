/**
 * Shared stream collection for CLI backend adapters
 *
 * Handles: output guard, buffer management, line-by-line splitting, first-byte timeout.
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
  perf?: { firstStdout: number; firstDelta: number }
  startTime?: number
  /** First byte timeout in ms (0 = disabled). If no output within this time, throw error. */
  firstByteTimeoutMs?: number
  /** AbortSignal for external cancellation */
  signal?: AbortSignal
}

/**
 * Collect stdout from a subprocess with output guard protection.
 *
 * If `processLine` is provided, buffers text and splits into lines for processing.
 * Otherwise, passes raw chunks directly (suitable for plain-text backends like iflow).
 *
 * Throws on first-byte timeout if configured (detects network stalls).
 */
export async function collectStream(
  subprocess: ResultPromise,
  options: CollectStreamOptions = {}
): Promise<string> {
  const { processLine, onChunk, perf, startTime, firstByteTimeoutMs, signal } = options
  const chunks: string[] = []
  const guard = createOutputGuard()
  let buffer = ''
  let firstByteTimeoutId: ReturnType<typeof setTimeout> | null = null
  let firstByteReceived = false

  // Set up first-byte timeout (detects network stalls where process starts but no output)
  if (firstByteTimeoutMs && firstByteTimeoutMs > 0) {
    firstByteTimeoutId = setTimeout(() => {
      if (!firstByteReceived && !signal?.aborted) {
        subprocess.kill('SIGTERM')
        throw new Error(`First byte timeout after ${firstByteTimeoutMs / 1000}s — network may be stalled`)
      }
    }, firstByteTimeoutMs)
  }

  try {
    if (subprocess.stdout) {
      for await (const chunk of subprocess.stdout) {
        // Cancel first-byte timeout on first output
        if (!firstByteReceived) {
          firstByteReceived = true
          if (firstByteTimeoutId) {
            clearTimeout(firstByteTimeoutId)
            firstByteTimeoutId = null
          }
        }

        const text = chunk.toString()

        if (perf && startTime && perf.firstStdout === 0) {
          perf.firstStdout = Date.now() - startTime
        }

        const accepted = guard.push(text)
        if (accepted) {
          chunks.push(text)
        }

        // Skip processing after output guard truncation to avoid wasting CPU
        // and prevent raw passthrough from writing unlimited data to stdout
        if (!accepted) continue

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

    // Process any remaining content in buffer (last line without newline)
    if (processLine && buffer.trim()) {
      processLine(buffer, onChunk)
    }

    await subprocess

    const output = chunks.join('')
    return guard.truncated
      ? output +
          `\n\n[OUTPUT TRUNCATED: exceeded limit, ${(guard.totalBytes / 1024 / 1024).toFixed(1)}MB total]`
      : output
  } finally {
    if (firstByteTimeoutId) {
      clearTimeout(firstByteTimeoutId)
    }
  }
}
