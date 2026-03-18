/**
 * JSON repair utilities for AI-generated workflow JSON.
 * Handles common AI generation mistakes: trailing commas, unescaped quotes,
 * control characters, comments, etc.
 */

import { createLogger } from '../../shared/logger.js'
import { getErrorMessage } from '../../shared/assertError.js'
import type { JsonWorkflowInput } from './parseJson.js'

const logger = createLogger('json-parser')

/**
 * Parse JSON text with auto-repair on failure.
 */
export function tryParseJson(text: string): JsonWorkflowInput {
  try {
    return JSON.parse(text) as JsonWorkflowInput
  } catch (firstError) {
    // Attempt auto-repair for common AI JSON generation mistakes
    const repaired = repairJson(text)
    if (repaired !== text) {
      try {
        logger.info('JSON parse failed, attempting auto-repair...')
        const result = JSON.parse(repaired) as JsonWorkflowInput
        logger.info('JSON auto-repair succeeded')
        return result
      } catch {
        // repair didn't help, fall through to original error
      }
    }
    const preview = text.length > 100 ? text.slice(0, 100) + '...' : text
    throw new Error(
      `Invalid JSON in AI response: ${getErrorMessage(firstError)}\n${preview}`
    )
  }
}

/** Fix common AI-generated JSON issues: trailing commas, unescaped control chars, comments, unescaped quotes */
function repairJson(text: string): string {
  let result = text

  // Remove JS-style comments (// ... and /* ... */) outside of strings
  result = removeJsonComments(result)

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([\]}])/g, '$1')

  // Fix unescaped newlines/tabs inside JSON string values
  // Walk through and fix control chars only inside quoted strings
  const chars: string[] = []
  let inStr = false
  let esc = false
  for (let i = 0; i < result.length; i++) {
    const ch = result[i]!
    if (esc) {
      chars.push(ch)
      esc = false
      continue
    }
    if (ch === '\\' && inStr) {
      chars.push(ch)
      esc = true
      continue
    }
    if (ch === '"') {
      inStr = !inStr
      chars.push(ch)
      continue
    }
    if (inStr) {
      if (ch === '\n') { chars.push('\\n'); continue }
      if (ch === '\r') { chars.push('\\r'); continue }
      if (ch === '\t') { chars.push('\\t'); continue }
    }
    chars.push(ch)
  }
  result = chars.join('')

  // Iteratively fix unescaped double quotes (up to 5 rounds)
  for (let round = 0; round < 5; round++) {
    try {
      JSON.parse(result)
      return result
    } catch (e) {
      const posMatch = getErrorMessage(e).match(/position\s+(\d+)/)
      if (!posMatch) return result
      const errorPos = parseInt(posMatch[1]!, 10)
      const fixed = tryEscapeQuoteAt(result, errorPos)
      if (fixed === result) return result // no progress
      result = fixed
    }
  }

  return result
}

/** Remove line comments and block comments outside of JSON strings */
function removeJsonComments(text: string): string {
  const out: string[] = []
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (esc) { out.push(ch); esc = false; continue }
    if (ch === '\\' && inStr) { out.push(ch); esc = true; continue }
    if (ch === '"') { inStr = !inStr; out.push(ch); continue }
    if (!inStr) {
      if (ch === '/' && text[i + 1] === '/') {
        // Skip until end of line
        const eol = text.indexOf('\n', i)
        i = eol === -1 ? text.length - 1 : eol - 1
        continue
      }
      if (ch === '/' && text[i + 1] === '*') {
        // Skip until */
        const end = text.indexOf('*/', i + 2)
        i = end === -1 ? text.length - 1 : end + 1
        continue
      }
    }
    out.push(ch)
  }
  return out.join('')
}

/**
 * Attempt to fix an unescaped quote at/near the error position.
 * Scans a small window around errorPos for a quote that looks like
 * it's inside a string value (not a structural delimiter).
 */
function tryEscapeQuoteAt(text: string, errorPos: number): string {
  // Search within a small window around the error position
  const searchStart = Math.max(0, errorPos - 2)
  const searchEnd = Math.min(text.length, errorPos + 3)

  for (let i = searchStart; i < searchEnd; i++) {
    if (text[i] !== '"') continue
    // Check if this quote is inside a string (preceded by non-structural context)
    // A structural quote is typically preceded by : , [ { or whitespace after these
    const before = text.slice(Math.max(0, i - 5), i).trimEnd()
    const after = text[i + 1] || ''
    // Skip if it looks like a structural delimiter (key-value boundary or array element)
    if (before.endsWith(':') || before.endsWith(',') || before.endsWith('[') || before.endsWith('{')) continue
    if (after === ':' || after === ',' || after === '}' || after === ']') continue
    // This quote is likely an unescaped quote inside a string value — escape it
    const fixed = text.slice(0, i) + '\\"' + text.slice(i + 1)
    // Validate the fix helped (try parse, or at least check error moves forward)
    try {
      JSON.parse(fixed)
      return fixed
    } catch (e2) {
      const newMatch = getErrorMessage(e2).match(/position\s+(\d+)/)
      const newPos = newMatch ? parseInt(newMatch[1]!, 10) : 0
      if (newPos > errorPos) {
        // Progress — apply fix and try once more recursively
        return tryEscapeQuoteAt(fixed, newPos)
      }
    }
  }
  return text
}
