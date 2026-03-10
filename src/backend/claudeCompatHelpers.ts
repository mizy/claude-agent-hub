/**
 * Shared helpers for Claude-compatible CLI backends
 *
 * Used by claudeCodeBackend, codebuddyBackend, and opencodeBackend.
 * Covers: MCP config, base64 image extraction, stream event types.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('backend-compat')

// ============ Stream Event Types ============

export interface StreamContentBlock {
  type: string
  id?: string // tool_use ID
  name?: string // tool name (e.g. "Read", "mcp__playwright__browser_take_screenshot")
  text?: string
  tool_use_id?: string // for tool_result blocks, references the tool_use ID
  source?: { type: string; media_type?: string; data?: string }
  content?: StreamContentBlock[] // tool_result blocks nest content inside
  input?: Record<string, unknown> // tool_use input params (e.g. { file_path: "/tmp/foo.png" })
}

export interface StreamJsonEvent {
  type: string
  message?: {
    content?: StreamContentBlock[]
  }
  content?: StreamContentBlock[]
  tool_use_id?: string
  tool_use_result?: {
    stdout?: string
    stderr?: string
  }
  event?: {
    type: string
    delta?: { type: string; text?: string }
  }
  session_id?: string
  sessionId?: string
  sessionID?: string
  duration_api_ms?: number
  durationApiMs?: number
  duration_ms?: number
  total_cost_usd?: number
  totalCostUsd?: number
  cost?: number
  usage?: Record<string, unknown>
  tokenUsage?: Record<string, unknown>
  tokens?: Record<string, unknown>
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  error?: unknown
}

export interface ExtractedEventMetrics {
  durationApiMs?: number
  costUsd?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

const EMPTY_RECORD: Record<string, unknown> = {}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Extract incremental text from a single JSON event line.
 * Supports both Claude stream_event and OpenCode step/text style payloads.
 */
export function extractEventTextDelta(event: Record<string, unknown>): string | undefined {
  // Claude stream-json delta event
  const streamEvent = asRecord(event.event)
  const delta = asRecord(streamEvent?.delta)
  if (
    event.type === 'stream_event' &&
    streamEvent?.type === 'content_block_delta' &&
    delta?.type === 'text_delta' &&
    typeof delta.text === 'string'
  ) {
    return delta.text
  }

  // OpenCode text event: { type: "text", part: { text: "..." } }
  if (event.type === 'text') {
    const part = asRecord(event.part)
    if (typeof part?.text === 'string') return part.text
    const text = event.text ?? event.content ?? event.result
    if (typeof text === 'string') return text
  }

  return undefined
}

export function extractAssistantTextFromEvent(event: StreamJsonEvent): string {
  if (event.type !== 'assistant' || !event.message?.content) return ''
  return event.message.content
    .filter(block => block.type === 'text' && block.text)
    .map(block => block.text)
    .join('')
}

/** Extract session ID from common event field variants */
export function extractEventSessionId(event: Record<string, unknown>): string | undefined {
  return pickString(event, ['sessionID', 'session_id', 'sessionId'])
}

function extractTokenUsage(record: Record<string, unknown>): {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
} {
  const promptTokens = pickNumber(record, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'])
  const completionTokens = pickNumber(record, [
    'output_tokens',
    'outputTokens',
    'completion_tokens',
    'completionTokens',
  ])
  const totalTokens = pickNumber(record, ['total_tokens', 'totalTokens'])
  return { promptTokens, completionTokens, totalTokens }
}

/** Extract API duration/cost/token usage from one event line */
export function extractEventMetrics(event: Record<string, unknown>): ExtractedEventMetrics {
  const metrics: ExtractedEventMetrics = {
    durationApiMs: pickNumber(event, ['duration_api_ms', 'durationApiMs', 'duration_ms']),
    costUsd: pickNumber(event, ['total_cost_usd', 'totalCostUsd', 'cost', 'total_cost']),
  }

  const directUsage = extractTokenUsage(event)
  metrics.promptTokens = directUsage.promptTokens
  metrics.completionTokens = directUsage.completionTokens
  metrics.totalTokens = directUsage.totalTokens

  // Check nested objects: usage, tokenUsage, tokens (Claude), and part (OpenCode step_finish)
  for (const key of ['usage', 'tokenUsage', 'tokens', 'part']) {
    const nested = asRecord(event[key])
    if (!nested) continue

    // OpenCode step_finish: part.cost holds cost, part.tokens holds token counts
    if (key === 'part') {
      if (metrics.costUsd == null) {
        metrics.costUsd = pickNumber(nested, ['cost', 'total_cost', 'total_cost_usd'])
      }
      // Try part.tokens sub-object first (opencode v1.x structure)
      const partTokens = asRecord(nested.tokens)
      if (partTokens) {
        const partUsage = extractTokenUsage(partTokens)
        if (metrics.promptTokens == null && partUsage.promptTokens != null) {
          metrics.promptTokens = partUsage.promptTokens
        }
        if (metrics.completionTokens == null && partUsage.completionTokens != null) {
          metrics.completionTokens = partUsage.completionTokens
        }
        if (metrics.totalTokens == null && partUsage.totalTokens != null) {
          metrics.totalTokens = partUsage.totalTokens
        }
      }
      // Fallback: part may directly have input_tokens/output_tokens at top level
      const partDirectUsage = extractTokenUsage(nested)
      if (metrics.promptTokens == null && partDirectUsage.promptTokens != null) {
        metrics.promptTokens = partDirectUsage.promptTokens
      }
      if (metrics.completionTokens == null && partDirectUsage.completionTokens != null) {
        metrics.completionTokens = partDirectUsage.completionTokens
      }
      if (metrics.totalTokens == null && partDirectUsage.totalTokens != null) {
        metrics.totalTokens = partDirectUsage.totalTokens
      }
      continue
    }

    const nestedUsage = extractTokenUsage(nested)
    if (metrics.promptTokens == null && nestedUsage.promptTokens != null) {
      metrics.promptTokens = nestedUsage.promptTokens
    }
    if (metrics.completionTokens == null && nestedUsage.completionTokens != null) {
      metrics.completionTokens = nestedUsage.completionTokens
    }
    if (metrics.totalTokens == null && nestedUsage.totalTokens != null) {
      metrics.totalTokens = nestedUsage.totalTokens
    }
  }

  if (metrics.totalTokens == null && metrics.promptTokens != null && metrics.completionTokens != null) {
    metrics.totalTokens = metrics.promptTokens + metrics.completionTokens
  }

  return metrics
}

/** Extract human-readable error from event line */
export function extractEventError(event: Record<string, unknown>): string | undefined {
  if (event.type !== 'error' && event.is_error !== true) return undefined

  const errorRecord = asRecord(event.error)
  const nestedData = asRecord(errorRecord?.data)
  const msg =
    pickString(event, ['message']) ??
    pickString(nestedData ?? EMPTY_RECORD, ['message']) ??
    pickString(errorRecord ?? EMPTY_RECORD, ['message'])

  if (msg) return msg
  if (errorRecord) return JSON.stringify(errorRecord)
  return 'Unknown backend error event'
}

// ============ MCP Config ============

/** Build a JSON string for --mcp-config from Claude Code's global config (~/.claude.json) */
export function buildMcpConfigJson(serverNames: string[]): string {
  try {
    const configPath = join(homedir(), '.claude.json')
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    const allServers = config.mcpServers ?? {}

    const selected: Record<string, unknown> = {}
    for (const name of serverNames) {
      if (allServers[name]) {
        selected[name] = allServers[name]
      } else {
        logger.warn(`MCP server "${name}" not found in ~/.claude.json, skipping`)
      }
    }

    if (Object.keys(selected).length === 0) return ''
    return JSON.stringify({ mcpServers: selected })
  } catch (e) {
    logger.warn(`Failed to read MCP config: ${getErrorMessage(e)}`)
    return ''
  }
}

// ============ MCP Image Extraction ============

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp|bmp)$/i

/**
 * Returns true for image files in system temp dirs that are safe to forward to chat.
 * Excludes user-uploaded images (e.g. lark-img-* in ~/.cah-data/tmp/) to avoid echoing them back.
 */
function isScreenshotPath(filePath: unknown): boolean {
  if (typeof filePath !== 'string') return false
  if (!IMAGE_EXT_RE.test(filePath)) return false
  // Must be in a system temp dir
  const tempDirs = ['/tmp/', '/var/tmp/', process.env['TMPDIR']].filter(Boolean) as string[]
  return tempDirs.some(dir => filePath.startsWith(dir))
}

/** Save base64-encoded image data to a temp file and return the path */
export function saveBase64Image(data: string, mediaType?: string): string {
  const ext = mediaType?.includes('png') ? 'png' : mediaType?.includes('gif') ? 'gif' : 'png'
  const filePath = join(tmpdir(), `cah-mcp-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  writeFileSync(filePath, Buffer.from(data, 'base64'))
  logger.debug(`Saved MCP image to ${filePath}`)
  return filePath
}

/**
 * Extract base64 image content blocks from a user/tool_result event.
 * Skips tool_result blocks whose tool_use_id is NOT from an MCP tool
 * (e.g. built-in Read tool reading user images should not be echoed back).
 */
export function extractImagesFromEvent(event: StreamJsonEvent, mcpToolUseIds: Set<string>): string[] {
  if (event.type !== 'user' && event.type !== 'tool_result') return []
  const rootBlocks = event.message?.content ?? (Array.isArray(event.content) ? event.content : undefined)
  if (!rootBlocks) return []

  const paths: string[] = []

  function extractFromBlocks(blocks: StreamContentBlock[], insideMcpResult: boolean) {
    for (const block of blocks) {
      if (block.type === 'image' && block.source?.type === 'base64' && block.source.data) {
        if (insideMcpResult) {
          try {
            paths.push(saveBase64Image(block.source.data, block.source.media_type))
          } catch (e) {
            logger.debug(`Failed to save base64 image: ${getErrorMessage(e)}`)
          }
        }
      }
      if (block.type === 'tool_result' && block.content) {
        const isMcp = !!(block.tool_use_id && mcpToolUseIds.has(block.tool_use_id))
        extractFromBlocks(block.content, isMcp)
      }
    }
  }

  const initialInsideMcp =
    event.type === 'tool_result'
      ? !!(event.tool_use_id && mcpToolUseIds.has(event.tool_use_id))
      : false

  extractFromBlocks(rootBlocks, initialInsideMcp)
  return paths
}

// ============ Claude-compat Stream Processing ============

/**
 * Build the claude-compatible processLine callback for collectStream.
 * Handles: incremental text deltas, MCP tool_use tracking, image extraction.
 */
export function createClaudeCompatStreamProcessor(options: {
  mcpToolUseIds: Set<string>
  extractedImagePaths: string[]
  perf?: { spawn: number; firstStdout: number; firstDelta: number }
  startTime?: number
  fallbackWrite?: (text: string) => void
}): (line: string, cb?: (chunk: string) => void) => void {
  const { mcpToolUseIds, extractedImagePaths, perf, startTime, fallbackWrite } = options

  return (line: string, cb?: (chunk: string) => void) => {
    try {
      const rawEvent = JSON.parse(line) as Record<string, unknown>
      const event = rawEvent as unknown as StreamJsonEvent

      const errorMsg = extractEventError(rawEvent)
      if (errorMsg) {
        logger.warn(`backend stream error event: ${errorMsg}`)
      }

      // Incremental text deltas (--include-partial-messages or OpenCode text events)
      const deltaText = extractEventTextDelta(rawEvent)
      if (deltaText) {
        if (perf && startTime && perf.firstDelta === 0) {
          perf.firstDelta = Date.now() - startTime
        }
        if (cb) cb(deltaText)
        else fallbackWrite?.(deltaText)
        return
      }

      if (event.type === 'tool_call') {
        const toolName =
          typeof rawEvent.name === 'string'
            ? rawEvent.name
            : pickString(asRecord(rawEvent.tool) ?? EMPTY_RECORD, ['name'])
        const toolId =
          pickString(rawEvent, ['id', 'tool_use_id', 'toolUseId']) ??
          pickString(asRecord(rawEvent.tool) ?? EMPTY_RECORD, ['id', 'tool_use_id', 'toolUseId'])
        const input =
          asRecord(rawEvent.input) ??
          asRecord(asRecord(rawEvent.tool)?.input) ??
          asRecord(asRecord(rawEvent.tool_call)?.input)

        if (toolId) {
          if (toolName?.startsWith('mcp__')) {
            mcpToolUseIds.add(toolId)
          } else if (toolName === 'Read' && isScreenshotPath(input?.file_path)) {
            // Read tool viewing images is internal process — skip forwarding to user
            logger.debug(`Skipping Read tool image (internal): ${input?.file_path}`)
          }
        }
      } else if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use' && block.id) {
            if (block.name?.startsWith('mcp__')) {
              mcpToolUseIds.add(block.id)
            } else if (block.name === 'Read' && isScreenshotPath(block.input?.file_path)) {
              // Read tool viewing images is internal process — don't forward to user
              logger.debug(`Skipping Read tool image (internal): ${block.input?.file_path}`)
            }
          }
        }
        if (!cb && fallbackWrite) {
          const assistantText = extractAssistantTextFromEvent(event)
          if (assistantText) fallbackWrite(assistantText + '\n')
        }
      } else if (event.type === 'user' || event.type === 'tool_result') {
        const imgPaths = extractImagesFromEvent(event, mcpToolUseIds)
        extractedImagePaths.push(...imgPaths)

        if (event.tool_use_result) {
          const toolOutput =
            (event.tool_use_result.stdout ?? '') + (event.tool_use_result.stderr ?? '')
          if (toolOutput && !cb) fallbackWrite?.(toolOutput + '\n')
        }
      }
    } catch (e) {
      logger.debug(`Stream event parse failed: ${line.slice(0, 120)}`)
      if (!cb) fallbackWrite?.(line + '\n')
    }
  }
}
