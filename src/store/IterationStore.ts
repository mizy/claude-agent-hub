/**
 * IterationStore - 定时任务迭代记录存储
 *
 * 每次 loop-back edge 触发时，在 resetNodeState 清除 outputs 之前，
 * 将当前循环的节点输出快照保存为独立文件。
 *
 * 存储路径: {taskDir}/iterations/iter-{NNN}.json
 */

import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import { readJson, writeJson } from './readWriteJson.js'
import { TASK_PATHS } from './paths.js'

const logger = createLogger('iteration-store')

/** Max chars to keep per node output */
const OUTPUT_SUMMARY_LIMIT = 500

export interface IterationRecord {
  iterationNumber: number
  startedAt: string
  completedAt: string
  durationMs: number
  outputs: Record<string, string>  // nodeId → output summary (first 500 chars)
  status: 'completed' | 'failed'
  error?: string
}

function getIterationsDir(taskId: string): string {
  return join(TASK_PATHS.getDir(taskId), 'iterations')
}

function getIterationFilePath(taskId: string, iterationNumber: number): string {
  const padded = String(iterationNumber).padStart(3, '0')
  return join(getIterationsDir(taskId), `iter-${padded}.json`)
}

/** Truncate output to a string summary */
function summarizeOutput(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output.slice(0, OUTPUT_SUMMARY_LIMIT)
  if (typeof output === 'object' && '_raw' in (output as Record<string, unknown>)) {
    return String((output as Record<string, unknown>)._raw).slice(0, OUTPUT_SUMMARY_LIMIT)
  }
  const json = JSON.stringify(output)
  return json.slice(0, OUTPUT_SUMMARY_LIMIT)
}

/**
 * Save an iteration record for a task
 */
export function saveIteration(taskId: string, record: IterationRecord): void {
  const dir = getIterationsDir(taskId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const filePath = getIterationFilePath(taskId, record.iterationNumber)
  writeJson(filePath, record)
  logger.debug(`Saved iteration ${record.iterationNumber} for task ${taskId}`)
}

/**
 * List all iteration records for a task, sorted by iterationNumber
 */
export function listIterations(taskId: string): IterationRecord[] {
  const dir = getIterationsDir(taskId)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter(f => f.startsWith('iter-') && f.endsWith('.json'))
    .sort()

  const records: IterationRecord[] = []
  for (const file of files) {
    const record = readJson<IterationRecord>(join(dir, file))
    if (record) records.push(record)
  }
  return records
}

/**
 * Get a specific iteration record by number
 */
export function getIteration(taskId: string, iterationNumber: number): IterationRecord | null {
  const filePath = getIterationFilePath(taskId, iterationNumber)
  return readJson<IterationRecord>(filePath)
}

/** Count existing iteration files without parsing them all */
function countIterations(taskId: string): number {
  const dir = getIterationsDir(taskId)
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter(f => f.startsWith('iter-') && f.endsWith('.json')).length
}

/**
 * Build an IterationRecord from current instance outputs.
 * Called before resetLoopPath clears the outputs.
 */
export function buildIterationRecord(
  taskId: string,
  outputs: Record<string, unknown>,
  loopNodeIds: string[],
  status: 'completed' | 'failed' = 'completed',
  error?: string
): IterationRecord {
  const iterationNumber = countIterations(taskId) + 1
  const now = new Date().toISOString()

  // Summarize outputs for nodes in the loop path
  const outputSummaries: Record<string, string> = {}
  for (const nodeId of loopNodeIds) {
    if (nodeId in outputs) {
      outputSummaries[nodeId] = summarizeOutput(outputs[nodeId])
    }
  }

  return {
    iterationNumber,
    startedAt: now, // Caller should overwrite with _loopStartedAt if available
    completedAt: now,
    durationMs: 0,
    outputs: outputSummaries,
    status,
    error,
  }
}
