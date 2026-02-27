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
}

export interface StreamJsonEvent {
  type: string
  message?: {
    content?: StreamContentBlock[]
  }
  tool_use_result?: {
    stdout?: string
    stderr?: string
  }
  event?: {
    type: string
    delta?: { type: string; text?: string }
  }
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
  if (event.type !== 'user' || !event.message?.content) return []
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

  extractFromBlocks(event.message.content, false)
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
      const event = JSON.parse(line) as StreamJsonEvent

      // Incremental text deltas (--include-partial-messages)
      if (
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_delta' &&
        event.event.delta?.type === 'text_delta' &&
        event.event.delta.text
      ) {
        if (perf && startTime && perf.firstDelta === 0) {
          perf.firstDelta = Date.now() - startTime
        }
        if (cb) cb(event.event.delta.text)
        else fallbackWrite?.(event.event.delta.text)
      } else if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use' && block.id && block.name?.startsWith('mcp__')) {
            mcpToolUseIds.add(block.id)
          }
        }
        if (!cb && fallbackWrite) {
          let assistantText = ''
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) assistantText += block.text
          }
          if (assistantText) fallbackWrite(assistantText + '\n')
        }
      } else if (event.type === 'user') {
        const imgPaths = extractImagesFromEvent(event, mcpToolUseIds)
        extractedImagePaths.push(...imgPaths)

        if (event.tool_use_result) {
          const toolOutput =
            (event.tool_use_result.stdout ?? '') + (event.tool_use_result.stderr ?? '')
          if (toolOutput && !cb) fallbackWrite?.(toolOutput + '\n')
        }
      }
    } catch {
      if (!cb) fallbackWrite?.(line + '\n')
    }
  }
}
