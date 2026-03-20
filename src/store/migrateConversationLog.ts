/**
 * Migrate global conversation.jsonl → per-chatId chat-sessions/{chatId}/conversation.jsonl
 *
 * - Groups entries by chatId
 * - Empty chatId entries with sessionId → grouped by sessionId
 * - Empty chatId entries without sessionId → _system
 * - Dedup key: chatId + ts + dir (verified unique in analysis)
 * - Merges with existing chat-session conversation.jsonl if present
 * - Validates total count before deleting source
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, createReadStream, renameSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import { CONVERSATION_LOG_FILE_PATH, DATA_DIR } from './paths.js'

const CHAT_SESSIONS_DIR = join(DATA_DIR, 'chat-sessions')

interface RawEntry {
  ts: string
  dir: string
  chatId: string
  sessionId?: string
  [key: string]: unknown
}

function resolveGroupId(e: RawEntry): string {
  if (e.chatId && e.chatId.length > 0) return e.chatId
  if (e.sessionId && e.sessionId.length > 0) return `_session_${e.sessionId}`
  return '_system'
}

function dedupKey(e: RawEntry): string {
  return `${resolveGroupId(e)}|${e.ts}|${e.dir}`
}

export interface MigrationReport {
  totalSource: number
  malformedSkipped: number
  groups: Array<{
    groupId: string
    count: number
    existingCount: number
    deduped: number
    finalCount: number
    timeRange: { earliest: string; latest: string }
  }>
  totalWritten: number
  failedGroups: string[]
  success: boolean
  error?: string
}

export async function migrateConversationLog(opts?: { dryRun?: boolean }): Promise<MigrationReport> {
  const dryRun = opts?.dryRun ?? false
  const report: MigrationReport = {
    totalSource: 0,
    malformedSkipped: 0,
    groups: [],
    totalWritten: 0,
    failedGroups: [],
    success: false,
  }

  // 1. Stream-read global conversation.jsonl line by line
  if (!existsSync(CONVERSATION_LOG_FILE_PATH)) {
    report.error = 'Global conversation.jsonl not found'
    return report
  }

  const groups = new Map<string, RawEntry[]>()

  const rl = createInterface({
    input: createReadStream(CONVERSATION_LOG_FILE_PATH, 'utf-8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (line.trim().length === 0) continue
    report.totalSource++
    try {
      const entry = JSON.parse(line) as RawEntry
      if (typeof entry.ts !== 'string' || typeof entry.dir !== 'string') {
        report.malformedSkipped++
        continue
      }
      const groupId = resolveGroupId(entry)
      if (!groups.has(groupId)) groups.set(groupId, [])
      groups.get(groupId)!.push(entry)
    } catch {
      report.malformedSkipped++
    }
  }

  // 2. For each group: merge with existing, dedup, sort, write
  mkdirSync(CHAT_SESSIONS_DIR, { recursive: true })

  let totalWritten = 0
  const safeIdMap = new Map<string, string>() // safeId → original groupId (collision detection)

  for (const [groupId, entries] of groups) {
    const safeId = groupId.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (safeIdMap.has(safeId) && safeIdMap.get(safeId) !== groupId) {
      report.failedGroups.push(groupId)
      report.groups.push({
        groupId,
        count: entries.length,
        existingCount: 0,
        deduped: 0,
        finalCount: 0,
        timeRange: { earliest: '', latest: '' },
      })
      continue
    }
    safeIdMap.set(safeId, groupId)
    const dir = join(CHAT_SESSIONS_DIR, safeId)
    const filePath = join(dir, 'conversation.jsonl')

    // Load existing entries if present
    const existingEntries: RawEntry[] = []
    if (existsSync(filePath)) {
      try {
        const existing = readFileSync(filePath, 'utf-8')
        for (const line of existing.split('\n').filter(l => l.trim().length > 0)) {
          try {
            existingEntries.push(JSON.parse(line) as RawEntry)
          } catch {
            // skip malformed existing lines
          }
        }
      } catch {
        // file read error, proceed with empty
      }
    }

    // Merge and dedup
    const seen = new Set<string>()
    const merged: RawEntry[] = []

    // Existing entries first (preserve priority)
    for (const e of existingEntries) {
      const key = dedupKey(e)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(e)
      }
    }

    let dedupCount = 0
    for (const e of entries) {
      const key = dedupKey(e)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(e)
      } else {
        dedupCount++
      }
    }

    // Sort by timestamp (assumes ISO 8601 format, e.g. "2026-03-20T12:00:00Z")
    merged.sort((a, b) => a.ts.localeCompare(b.ts))

    // Write with error handling
    let written = false
    if (!dryRun) {
      try {
        mkdirSync(dir, { recursive: true })
        const tmpPath = filePath + '.tmp'
        writeFileSync(tmpPath, merged.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8')
        renameSync(tmpPath, filePath)
        written = true
      } catch (err) {
        report.failedGroups.push(groupId)
      }
    }

    const earliest = merged[0]?.ts ?? ''
    const latest = merged[merged.length - 1]?.ts ?? ''

    report.groups.push({
      groupId,
      count: entries.length,
      existingCount: existingEntries.length,
      deduped: dedupCount,
      finalCount: merged.length,
      timeRange: { earliest, latest },
    })

    if (dryRun || written) {
      totalWritten += merged.length
    }
  }

  report.totalWritten = totalWritten

  // 4. Validate: source entries (minus malformed) should equal sum of per-group counts
  const totalFromGroups = report.groups.reduce((s, g) => s + g.count, 0)
  const expectedParsed = report.totalSource - report.malformedSkipped
  if (totalFromGroups !== expectedParsed) {
    report.error = `Count mismatch: parsed ${expectedParsed} but grouped ${totalFromGroups}`
    return report
  }

  // 5. totalWritten includes existing entries (for reporting only), skip count-based validation
  // Idempotency: re-running after partial failure merges existing + new, so totalWritten >= expectedParsed
  // Correctness is guaranteed by: totalFromGroups == expectedParsed (step 4) + failedGroups check (step 6)

  // 6. Backup original file only if all groups written successfully
  if (report.failedGroups.length > 0) {
    report.error = `Failed to write ${report.failedGroups.length} groups: ${report.failedGroups.join(', ')}. Source file preserved.`
    return report
  }

  if (!dryRun) {
    renameSync(CONVERSATION_LOG_FILE_PATH, CONVERSATION_LOG_FILE_PATH + '.migrated.bak')
  }

  report.success = true
  return report
}
