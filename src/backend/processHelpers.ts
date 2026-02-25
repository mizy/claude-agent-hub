/**
 * Shared process helpers for backend adapters
 */

import type { ResultPromise } from 'execa'

/** Collect stderr output from subprocess (non-blocking, for error detection) */
export function collectStderr(subprocess: ResultPromise, onDone: (text: string) => void): void {
  if (!subprocess.stderr) return
  const chunks: string[] = []
  subprocess.stderr.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()) })
  subprocess.stderr.on('end', () => { onDone(chunks.join('')) })
}
