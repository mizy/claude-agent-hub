/**
 * Generate project milestones from git history
 *
 * Reads git log, clusters commits by week, and extracts milestones
 * with version numbers, titles, and key changes.
 *
 * Storage: ~/.cah-data/milestones.json
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { DATA_DIR } from '../store/paths.js'
import { getErrorMessage } from '../shared/assertError.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('milestones')

export const MILESTONES_PATH = join(DATA_DIR, 'milestones.json')

// ============ Types ============

export interface Milestone {
  version: string
  dateRange: { from: string; to: string }
  title: string
  description: string
  keyChanges: string[]
  commitCount: number
}

export interface MilestonesData {
  milestones: Milestone[]
  lastCommitHash: string
  generatedAt: string
}

// ============ Internal Types ============

interface CommitInfo {
  hash: string
  date: string // ISO date (YYYY-MM-DD)
  message: string
  type: string // feat, fix, refactor, etc.
  scope: string // extracted from message
}

// ============ Git Parsing ============

/** Parse git log output into structured commit info */
function parseGitLog(raw: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  const lines = raw.trim().split('\n').filter(Boolean)

  for (const line of lines) {
    // Format: hash|date|message
    const parts = line.split('|')
    if (parts.length < 3) continue

    const hash = parts[0]!.trim()
    const date = parts[1]!.trim().slice(0, 10) // YYYY-MM-DD
    const message = parts.slice(2).join('|').trim()

    const { type, scope } = parseCommitMessage(message)
    commits.push({ hash, date, message, type, scope })
  }

  return commits
}

/** Extract type and scope from conventional commit message */
function parseCommitMessage(message: string): { type: string; scope: string } {
  // Match patterns: feat: xxx, fix(scope): xxx, feat: 中文描述
  const match = message.match(/^(\w+)(?:\(([^)]*)\))?[!]?:\s*(.*)/)
  if (match) {
    return { type: match[1]!, scope: match[2] || match[3] || '' }
  }
  return { type: 'other', scope: message.slice(0, 50) }
}

// ============ Clustering ============

/** Get ISO week key for grouping (YYYY-Www) */
function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  // Get ISO week number
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1
  const weekNum = Math.ceil((dayOfYear + jan1.getUTCDay()) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/** Cluster commits by week */
function clusterByWeek(commits: CommitInfo[]): Map<string, CommitInfo[]> {
  const weeks = new Map<string, CommitInfo[]>()
  for (const c of commits) {
    const key = getWeekKey(c.date)
    const list = weeks.get(key) || []
    list.push(c)
    weeks.set(key, list)
  }
  return weeks
}

// ============ Milestone Extraction ============

/** Pick the best title from a week's commits */
function pickTitle(commits: CommitInfo[]): string {
  // Prefer feat commits, then fix, then whatever has the most
  const feats = commits.filter(c => c.type === 'feat')
  if (feats.length > 0) {
    // Pick the longest feat message (likely most descriptive)
    const best = feats.reduce((a, b) => a.message.length > b.message.length ? a : b)
    return best.message.replace(/^feat[^:]*:\s*/, '').slice(0, 80)
  }

  const fixes = commits.filter(c => c.type === 'fix')
  if (fixes.length > 0) {
    return `Bug fixes and stability (${fixes.length} fixes)`
  }

  return `Development progress (${commits.length} commits)`
}

/** Generate a one-line description summarizing the week */
function generateDescription(commits: CommitInfo[]): string {
  const typeCounts: Record<string, number> = {}
  for (const c of commits) {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1
  }

  const parts: string[] = []
  if (typeCounts['feat']) parts.push(`${typeCounts['feat']} features`)
  if (typeCounts['fix']) parts.push(`${typeCounts['fix']} fixes`)
  if (typeCounts['refactor']) parts.push(`${typeCounts['refactor']} refactors`)

  const knownCount = (typeCounts['feat'] ?? 0) + (typeCounts['fix'] ?? 0) + (typeCounts['refactor'] ?? 0)
  const otherCount = commits.length - knownCount
  if (otherCount > 0) parts.push(`${otherCount} other changes`)

  return parts.join(', ') || `${commits.length} commits`
}

/** Extract key changes from commits, deduplicated by scope/type */
function extractKeyChanges(commits: CommitInfo[]): string[] {
  const changes: string[] = []
  const seen = new Set<string>()

  // Prioritize feat > fix > refactor
  const sorted = [...commits].sort((a, b) => {
    const order: Record<string, number> = { feat: 0, fix: 1, refactor: 2 }
    return (order[a.type] ?? 3) - (order[b.type] ?? 3)
  })

  for (const c of sorted) {
    if (changes.length >= 8) break
    const key = `${c.type}:${c.scope.slice(0, 20)}`
    if (seen.has(key)) continue
    seen.add(key)

    const label = c.message.replace(/^[\w]+[^:]*:\s*/, '').slice(0, 100)
    if (label) changes.push(label)
  }

  return changes
}

// ============ Main ============

const VALID_GIT_HASH = /^[0-9a-f]{7,40}$/i

/** @entry Generate milestones from git history */
export function generateMilestones(lastCommitHash?: string): MilestonesData {
  // Validate hash to prevent command injection (hash comes from disk JSON)
  if (lastCommitHash && !VALID_GIT_HASH.test(lastCommitHash)) {
    logger.warn(`Invalid commit hash in milestones.json, regenerating fully`)
    lastCommitHash = undefined
  }

  // Read existing data for incremental mode
  let existingData: MilestonesData | null = null
  if (lastCommitHash) {
    try {
      if (existsSync(MILESTONES_PATH)) {
        existingData = JSON.parse(readFileSync(MILESTONES_PATH, 'utf-8')) as MilestonesData
      }
    } catch {
      // ignore, will regenerate fully
    }
  }

  // Build git log command
  const hashRange = lastCommitHash ? `${lastCommitHash}..HEAD` : ''
  let raw: string
  try {
    raw = execSync(
      `git log ${hashRange} --format="%H|%aI|%s" --reverse`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    )
  } catch (error) {
    logger.warn(`Failed to read git log: ${getErrorMessage(error)}`)
    // Return existing or empty
    return existingData || { milestones: [], lastCommitHash: '', generatedAt: new Date().toISOString() }
  }

  const newCommits = parseGitLog(raw)
  if (newCommits.length === 0) {
    return existingData || { milestones: [], lastCommitHash: '', generatedAt: new Date().toISOString() }
  }

  // Cluster by week
  const weeks = clusterByWeek(newCommits)

  // Determine starting version number
  const startVersion = existingData ? existingData.milestones.length : 0

  // Generate milestones from weekly clusters
  const newMilestones: Milestone[] = []
  const sortedWeeks = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))

  for (let i = 0; i < sortedWeeks.length; i++) {
    const [, commits] = sortedWeeks[i]!
    if (!commits || commits.length === 0) continue

    const dates = commits.map(c => c.date).sort()
    const versionNum = startVersion + i + 1

    newMilestones.push({
      version: `v0.${versionNum}`,
      dateRange: { from: dates[0]!, to: dates[dates.length - 1]! },
      title: pickTitle(commits),
      description: generateDescription(commits),
      keyChanges: extractKeyChanges(commits),
      commitCount: commits.length,
    })
  }

  // Merge with existing milestones
  const allMilestones = existingData
    ? [...existingData.milestones, ...newMilestones]
    : newMilestones

  const lastHash = newCommits[newCommits.length - 1]!.hash

  const result: MilestonesData = {
    milestones: allMilestones,
    lastCommitHash: lastHash,
    generatedAt: new Date().toISOString(),
  }

  // Save to disk
  try {
    const dir = dirname(MILESTONES_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(MILESTONES_PATH, JSON.stringify(result, null, 2))
    logger.info(`Generated ${newMilestones.length} milestones (total: ${allMilestones.length})`)
  } catch (error) {
    logger.warn(`Failed to save milestones: ${getErrorMessage(error)}`)
  }

  return result
}

/** Load milestones from disk (returns null if not found) */
export function loadMilestones(): MilestonesData | null {
  try {
    if (!existsSync(MILESTONES_PATH)) return null
    return JSON.parse(readFileSync(MILESTONES_PATH, 'utf-8')) as MilestonesData
  } catch {
    return null
  }
}
