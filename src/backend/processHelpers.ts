/**
 * Shared process helpers for backend adapters
 */

import { execa } from 'execa'
import type { ResultPromise } from 'execa'

/** Collect stderr output from subprocess (non-blocking, for error detection) */
export function collectStderr(subprocess: ResultPromise, onDone: (text: string) => void): void {
  if (!subprocess.stderr) return
  const chunks: string[] = []
  subprocess.stderr.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()) })
  subprocess.stderr.on('end', () => { onDone(chunks.join('')) })
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*m/g
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?\b/

export interface ProbeCliVersionOptions {
  args?: string[]
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

function extractVersion(text: string): string | undefined {
  const clean = text.replace(ANSI_ESCAPE_RE, ' ')
  return clean.match(VERSION_RE)?.[0]
}

/**
 * Probe CLI availability by executing a version command.
 * Returns normalized version text when command exists and exposes version, else undefined.
 */
export async function probeCliVersion(
  binary: string,
  options: ProbeCliVersionOptions = {}
): Promise<string | undefined> {
  const { args = ['--version'], timeoutMs = 5000, env } = options
  try {
    const result = await execa(binary, args, {
      timeout: timeoutMs,
      env,
      reject: false,
    })
    if (result.exitCode !== 0) return undefined
    return extractVersion(`${result.stdout}\n${result.stderr}`)
  } catch {
    return undefined
  }
}
