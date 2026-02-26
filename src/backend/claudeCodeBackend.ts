/**
 * Claude Code CLI 后端适配器
 *
 * 将 Claude Code CLI 封装为 BackendAdapter 实现
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { execa, type ResultPromise } from 'execa'
import chalk from 'chalk'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { parseClaudeCompatOutput } from './parseClaudeCompatOutput.js'
import { createOutputGuard } from './outputGuard.js'

const logger = createLogger('claude-code')

interface StreamContentBlock {
  type: string
  id?: string // tool_use ID
  name?: string // tool name (e.g. "Read", "mcp__playwright__browser_take_screenshot")
  text?: string
  tool_use_id?: string // for tool_result blocks, references the tool_use ID
  source?: { type: string; media_type?: string; data?: string }
  content?: StreamContentBlock[] // tool_result blocks nest content inside
}

interface StreamJsonEvent {
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

// ============ Backend Adapter ============

export function createClaudeCodeBackend(): BackendAdapter {
  return {
    name: 'claude-code',
    displayName: 'Claude Code',
    cliBinary: 'claude',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: true,
      supportsMcpConfig: true,
      supportsAgentTeams: true,
    },

    async invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>> {
      const {
        prompt,
        cwd = process.cwd(),
        stream = false,
        skipPermissions = true,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        disableMcp = false,
        mcpServers,
        sessionId,
        model = 'opus',
        signal,
      } = options

      const args = buildArgs(prompt, skipPermissions, disableMcp, mcpServers, sessionId, stream, model)
      const startTime = Date.now()
      const perf = { spawn: 0, firstStdout: 0, firstDelta: 0 }

      try {
        // Remove CLAUDECODE env var to allow nested claude CLI calls
        const env = { ...process.env }
        delete env.CLAUDECODE

        const subprocess = execa('claude', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          // Always buffer stderr for error diagnostics; only skip stdout buffering in stream mode
          buffer: stream ? { stdout: false, stderr: true } : true,
          env,
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })
        perf.spawn = Date.now() - startTime

        let rawOutput: string
        let mcpImagePaths: string[] = []
        if (stream) {
          const streamResult = await streamOutput(subprocess, onChunk, startTime, perf)
          rawOutput = streamResult.rawOutput
          mcpImagePaths = streamResult.extractedImagePaths
        } else {
          const result = await subprocess
          rawOutput = result.stdout
        }

        const durationMs = Date.now() - startTime
        logger.debug(
          `[perf] spawn: ${perf.spawn}ms, first-stdout: ${perf.firstStdout}ms, first-delta: ${perf.firstDelta}ms, total: ${durationMs}ms`
        )
        const parsed = parseClaudeOutput(rawOutput)

        if (mcpImagePaths.length > 0) {
          logger.debug(`Extracted ${mcpImagePaths.length} MCP image(s): ${mcpImagePaths.join(', ')}`)
        }

        logger.info(
          `完成 (${(durationMs / 1000).toFixed(1)}s, API: ${((parsed.durationApiMs ?? 0) / 1000).toFixed(1)}s)`
        )

        return ok({
          prompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
          durationApiMs: parsed.durationApiMs,
          costUsd: parsed.costUsd,
          mcpImagePaths: mcpImagePaths.length > 0 ? mcpImagePaths : undefined,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'Claude Code'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        const env = { ...process.env }
        delete env.CLAUDECODE
        await execa('claude', ['--version'], { env, timeout: 5000 })
        return true
      } catch (e) {
        logger.debug(`claude not available: ${getErrorMessage(e)}`)
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(
  prompt: string,
  skipPermissions: boolean,
  disableMcp: boolean,
  mcpServers?: string[],
  sessionId?: string,
  stream?: boolean,
  model?: string
): string[] {
  const args: string[] = []

  if (sessionId) {
    args.push('--resume', sessionId)
  }

  if (model) {
    args.push('--model', model)
  }

  args.push('--print')

  if (stream) {
    args.push('--output-format', 'stream-json')
    args.push('--verbose')
    args.push('--include-partial-messages')
  } else {
    args.push('--output-format', 'json')
  }

  if (skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  // MCP control: selective enable via --strict-mcp-config + --mcp-config
  if (disableMcp) {
    args.push('--strict-mcp-config')
    // If specific servers requested, pass them via --mcp-config JSON
    if (mcpServers?.length) {
      const mcpConfig = buildMcpConfigJson(mcpServers)
      if (mcpConfig) args.push('--mcp-config', mcpConfig)
    }
  }

  args.push(prompt)
  return args
}

/** Build a JSON string for --mcp-config from Claude Code's global config (~/.claude.json) */
function buildMcpConfigJson(serverNames: string[]): string {
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

const parseClaudeOutput = parseClaudeCompatOutput

/** Save base64-encoded image data to a temp file and return the path */
function saveBase64Image(data: string, mediaType?: string): string {
  const ext = mediaType?.includes('png') ? 'png' : mediaType?.includes('gif') ? 'gif' : 'png'
  const filePath = join(tmpdir(), `cah-mcp-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  writeFileSync(filePath, Buffer.from(data, 'base64'))
  logger.debug(`Saved MCP image to ${filePath}`)
  return filePath
}

/** Extract base64 image content blocks from a user/tool_result event.
 *  Skips tool_result blocks whose tool_use_id is NOT from an MCP tool
 *  (e.g. built-in Read tool reading user images should not be echoed back). */
function extractImagesFromEvent(event: StreamJsonEvent, mcpToolUseIds: Set<string>): string[] {
  if (event.type !== 'user' || !event.message?.content) return []
  const paths: string[] = []

  function extractFromBlocks(blocks: StreamContentBlock[], insideMcpResult: boolean) {
    for (const block of blocks) {
      if (block.type === 'image' && block.source?.type === 'base64' && block.source.data) {
        // Only extract images from MCP tool results (e.g. playwright screenshots),
        // not from built-in Read tool results (which would echo user images back)
        if (insideMcpResult) {
          try {
            paths.push(saveBase64Image(block.source.data, block.source.media_type))
          } catch (e) {
            logger.debug(`Failed to save base64 image: ${getErrorMessage(e)}`)
          }
        }
      }
      // tool_result blocks nest their content inside a content array
      if (block.type === 'tool_result' && block.content) {
        const isMcp = !!(block.tool_use_id && mcpToolUseIds.has(block.tool_use_id))
        extractFromBlocks(block.content, isMcp)
      }
    }
  }

  extractFromBlocks(event.message.content, false)
  return paths
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void,
  startTime?: number,
  perf?: { spawn: number; firstStdout: number; firstDelta: number }
): Promise<{ rawOutput: string; extractedImagePaths: string[] }> {
  const chunks: string[] = []
  const extractedImagePaths: string[] = []
  // Track tool_use IDs from MCP tools (name starts with "mcp__") in assistant events.
  // Only images from these tool results should be sent back (e.g. playwright screenshots).
  // Built-in tool results (Read, Bash, etc.) are excluded to avoid echoing user images.
  const mcpToolUseIds = new Set<string>()
  const guard = createOutputGuard()
  let buffer = ''

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      const text = chunk.toString()

      // Record first stdout arrival
      if (perf && startTime && perf.firstStdout === 0) {
        perf.firstStdout = Date.now() - startTime
      }

      if (guard.push(text)) {
        chunks.push(text)
      }

      buffer += text

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line) as StreamJsonEvent

          // Incremental text deltas (--include-partial-messages)
          if (
            event.type === 'stream_event' &&
            event.event?.type === 'content_block_delta' &&
            event.event.delta?.type === 'text_delta' &&
            event.event.delta.text
          ) {
            // Record first delta (first token from API)
            if (perf && startTime && perf.firstDelta === 0) {
              perf.firstDelta = Date.now() - startTime
            }
            if (onChunk) {
              onChunk(event.event.delta.text)
            } else {
              process.stdout.write(chalk.dim(event.event.delta.text))
            }
          } else if (event.type === 'assistant' && event.message?.content) {
            // Track MCP tool_use IDs for image extraction filtering
            for (const block of event.message.content) {
              if (block.type === 'tool_use' && block.id && block.name?.startsWith('mcp__')) {
                mcpToolUseIds.add(block.id)
              }
            }
            // Complete assistant turn — only show in CLI when no streaming callback
            if (!onChunk) {
              let assistantText = ''
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  assistantText += block.text
                }
              }
              if (assistantText) {
                process.stdout.write(chalk.dim(assistantText + '\n'))
              }
            }
          } else if (event.type === 'user') {
            // Extract base64 images only from MCP tool results (e.g. playwright screenshots)
            const imgPaths = extractImagesFromEvent(event, mcpToolUseIds)
            extractedImagePaths.push(...imgPaths)

            // Tool output (build logs, test output etc.) — only show in CLI, never send to Lark
            if (event.tool_use_result) {
              const toolOutput =
                (event.tool_use_result.stdout ?? '') + (event.tool_use_result.stderr ?? '')
              if (toolOutput && !onChunk) {
                process.stdout.write(chalk.dim(toolOutput + '\n'))
              }
            }
          }
        } catch {
          // Non-JSON lines — only show in CLI terminal
          if (!onChunk) {
            process.stdout.write(chalk.dim(line + '\n'))
          }
        }
      }
    }
  }

  await subprocess

  const output = chunks.join('')
  const result = guard.truncated
    ? output + `\n\n[OUTPUT TRUNCATED: exceeded 100MB limit, ${(guard.totalBytes / 1024 / 1024).toFixed(1)}MB total]`
    : output

  return { rawOutput: result, extractedImagePaths }
}

