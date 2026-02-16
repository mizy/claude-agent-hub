/**
 * Read structured summary from result.md
 *
 * Extracts key information instead of naive truncation:
 * - Summary section (Status, Progress, Duration, Cost)
 * - Node execution statuses
 * - Error messages (if failed)
 */

import { readFile } from 'fs/promises'
import { getResultFilePath } from '../store/paths.js'

const SUMMARY_MAX_CHARS = 1200

/**
 * Parse result.md structurally and extract a concise summary.
 * Returns null if file doesn't exist or has no meaningful content.
 */
export async function readOutputSummary(taskId: string): Promise<string | null> {
  try {
    const content = await readFile(getResultFilePath(taskId), 'utf-8')
    if (!content.trim()) return null

    const parts: string[] = []

    // Extract Summary section (Status, Progress, Duration lines)
    const summaryMatch = content.match(/#+\s*Summary\s*\n([\s\S]*?)(?=\n#+\s|\n---|$)/i)
    if (summaryMatch) {
      const summaryLines = summaryMatch[1]!
        .split('\n')
        .filter(l => /^\s*[-*]?\s*(Status|Progress|Duration|Cost)\s*[:：]/i.test(l))
      if (summaryLines.length > 0) {
        parts.push(summaryLines.join('\n'))
      }
    }

    // Extract Node Execution results (lines like "✅ Node Name" or "❌ Node Name")
    const nodeSection = content.match(/#+\s*Node\s+Execut\w*\s*\n([\s\S]*?)(?=\n#+\s|\n---|$)/i)
    if (nodeSection) {
      const nodeLines = nodeSection[1]!
        .split('\n')
        .filter(l => /^\s*[-*]?\s*[✅❌🔵⏳⚠]/u.test(l))
        .slice(0, 10) // cap at 10 nodes
      if (nodeLines.length > 0) {
        parts.push(nodeLines.join('\n'))
      }
    }

    // Extract error info on failure
    const errorSection = content.match(
      /#+\s*(Workflow\s+)?Error\s*\n([\s\S]*?)(?=\n#+\s|\n--[-]+|$)/i
    )
    if (errorSection) {
      const errorText = errorSection[2]!.trim().slice(0, 200)
      if (errorText) {
        parts.push(`Error: ${errorText}`)
      }
    }

    if (parts.length === 0) {
      // Fallback: take first meaningful lines
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      const fallback = lines.slice(0, 8).join('\n')
      return fallback.length > SUMMARY_MAX_CHARS
        ? fallback.slice(0, SUMMARY_MAX_CHARS) + '...'
        : fallback || null
    }

    let summary = parts.join('\n\n')
    if (summary.length > SUMMARY_MAX_CHARS) {
      summary = summary.slice(0, SUMMARY_MAX_CHARS) + '...'
    }
    return summary
  } catch {
    return null
  }
}
