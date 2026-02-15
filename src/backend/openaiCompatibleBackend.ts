/**
 * OpenAI Compatible Backend
 *
 * Uses the openai SDK to call any OpenAI-compatible API (LM Studio, Ollama, vLLM, etc).
 * First backend that uses SDK directly instead of spawning a CLI subprocess.
 */

import OpenAI from 'openai'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import { buildClaudeSystemPrompt } from '../shared/readClaudeConfig.js'
import { resolveBackendConfig } from './resolveBackend.js'
import type { Result } from '../shared/result.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'

const logger = createLogger('openaiCompatible')

export function createOpenAICompatibleBackend(backendName?: string): BackendAdapter {
  // Conversation history per session for multi-turn reuse
  const sessions = new Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>()

  return {
    name: 'openai-compatible',
    displayName: 'OpenAI Compatible',
    cliBinary: '', // No CLI binary — SDK-based

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: false,
      supportsMcpConfig: false,
      supportsAgentTeams: false,
    },

    async invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>> {
      const {
        prompt,
        cwd = process.cwd(),
        stream = false,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        model,
        sessionId,
        signal,
      } = options

      const backendConfig = await resolveBackendConfig(backendName)
      const oaiConfig = backendConfig.openaiCompatible

      if (!oaiConfig) {
        return err({
          type: 'process',
          message: `backend.openaiCompatible config is required when type is "openai". Please check your config file for backend "${backendName || 'default'}".`,
        })
      }

      const client = new OpenAI({
        baseURL: oaiConfig.baseURL,
        apiKey: oaiConfig.apiKey || 'no-key',
        timeout: timeoutMs,
      })

      const resolvedModel = model || oaiConfig.defaultModel || 'default'

      // Build system prompt from Claude config if enabled
      let systemPrompt: string | undefined
      if (oaiConfig.useClaudeConfig !== false) {
        systemPrompt = buildClaudeSystemPrompt({
          projectPath: cwd,
          includeSkills: oaiConfig.includeSkills !== false,
        })
      }

      // Get or create session messages
      const sid = sessionId || `session-${Date.now()}`
      if (!sessions.has(sid)) {
        sessions.set(sid, [])
      }
      const messages = sessions.get(sid)!

      // Build request messages
      const requestMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

      if (systemPrompt) {
        requestMessages.push({ role: 'system', content: systemPrompt })
      }

      // Append history for session reuse
      requestMessages.push(...messages)

      // Add current user prompt
      requestMessages.push({ role: 'user', content: prompt })

      const startTime = Date.now()

      try {
        let response: string

        const maxTokens = oaiConfig.maxContextLength || 4096

        if (stream) {
          response = await streamCompletion(client, resolvedModel, requestMessages, maxTokens, onChunk, signal)
        } else {
          const completion = await client.chat.completions.create(
            {
              model: resolvedModel,
              messages: requestMessages,
              max_tokens: maxTokens,
            },
            signal ? { signal } : undefined
          )
          response = completion.choices[0]?.message?.content || ''
        }

        const durationMs = Date.now() - startTime

        // Save to session history for reuse
        messages.push({ role: 'user', content: prompt })
        messages.push({ role: 'assistant', content: response })

        logger.info(`完成 (${(durationMs / 1000).toFixed(1)}s, model: ${resolvedModel})`)

        return ok({
          prompt,
          response,
          durationMs,
          sessionId: sid,
        })
      } catch (error: unknown) {
        const durationMs = Date.now() - startTime

        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }

        if (error instanceof OpenAI.APIConnectionError) {
          return err({
            type: 'process',
            message: `连接失败: ${oaiConfig.baseURL} - ${error.message}`,
          })
        }
        if (error instanceof OpenAI.APIError) {
          return err({
            type: 'process',
            message: `API 错误 (${error.status}): ${error.message}`,
          })
        }

        // Timeout detection
        const msg = error instanceof Error ? error.message : String(error)
        if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
          return err({ type: 'timeout', message: `超时 (${durationMs}ms): ${msg}` })
        }

        return err({ type: 'process', message: msg })
      }
    },

    async checkAvailable(): Promise<boolean> {
      const backendConfig = await resolveBackendConfig(backendName)
      const oaiConfig = backendConfig.openaiCompatible
      if (!oaiConfig) return false

      try {
        const client = new OpenAI({
          baseURL: oaiConfig.baseURL,
          apiKey: oaiConfig.apiKey || 'no-key',
          timeout: 5000,
        })
        // Try listing models as a health check
        await client.models.list()
        return true
      } catch (e) {
        logger.debug(`OpenAI compatible API not available: ${e instanceof Error ? e.message : String(e)}`)
        return false
      }
    },
  }
}

async function streamCompletion(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens: number,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const stream = await client.chat.completions.create(
    { model, messages, stream: true, max_tokens: maxTokens },
    signal ? { signal } : undefined
  )

  const chunks: string[] = []
  for await (const event of stream) {
    const delta = event.choices[0]?.delta?.content
    if (delta) {
      chunks.push(delta)
      if (onChunk) {
        onChunk(delta)
      } else {
        process.stdout.write(delta)
      }
    }
  }

  return chunks.join('')
}
