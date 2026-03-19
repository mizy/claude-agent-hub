/**
 * iflow-cli 后端适配器
 *
 * 支持 Qwen3-Coder、DeepSeek-V3、Kimi-K2、GLM-4.6 等免费国产模型
 * 非交互模式: iflow -p "prompt" -y -m model
 *
 * 用户目录配置：
 * - 通过 IFLOW_HOME 环境变量指定 iflow 的用户目录
 * - 默认使用 cah 的 DATA_DIR/iflow 作为 iflow 的用户目录
 * - 这样 iflow 的配置、缓存、日志等都存储在 cah 的数据目录下
 */

import { execa, type ResultPromise } from 'execa'
import { ok, err } from '../shared/result.js'
import { createLogger } from '../shared/logger.js'
import type { Result } from '../shared/result.js'
import { toInvokeError } from '../shared/toInvokeError.js'
import { getErrorMessage } from '../shared/assertError.js'
import type { BackendAdapter, InvokeOptions, InvokeResult, InvokeError } from './types.js'
import { collectStderr } from './processHelpers.js'
import { collectStream } from './collectStream.js'
import { logCliCommand, buildRedactedCommand } from '../store/conversationLog.js'
import { DATA_DIR } from '../store/paths.js'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { writeIflowSystemPrompt } from './systemPromptWriter.js'

const logger = createLogger('iflow')

export function createIflowBackend(): BackendAdapter {
  return {
    name: 'iflow',
    displayName: 'iflow-cli',
    cliBinary: 'iflow',

    capabilities: {
      supportsStreaming: true,
      supportsSessionReuse: true,
      supportsCostTracking: false,
      supportsMcpConfig: false,
      supportsAgentTeams: false,
    },

    async invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>> {
      const {
        prompt: rawPrompt,
        systemPrompt,
        cwd = process.cwd(),
        stream = false,
        skipPermissions = true,
        timeoutMs = 30 * 60 * 1000,
        onChunk,
        model,
        sessionId,
        signal,
      } = options

      // 写入全局 system prompt 配置文件
      if (systemPrompt) {
        writeIflowSystemPrompt(systemPrompt)
      }

      const args = buildArgs(rawPrompt, model, sessionId, skipPermissions)
      const startTime = Date.now()

      const loggedPrompt = rawPrompt

      logCliCommand({
        backend: 'iflow',
        command: buildRedactedCommand('iflow', args, rawPrompt),
        prompt: loggedPrompt,
        sessionId,
        model,
        cwd,
      })

      // 设置 iflow 用户目录：优先使用环境变量，否则使用 cah 的 DATA_DIR/iflow
      const iflowHome = process.env.IFLOW_HOME || join(DATA_DIR, 'iflow')
      mkdirSync(iflowHome, { recursive: true })

      try {
        const subprocess = execa('iflow', args, {
          cwd,
          timeout: timeoutMs,
          stdin: 'ignore',
          buffer: stream ? { stdout: false, stderr: true } : true,
          env: {
            ...process.env,
            IFLOW_HOME: iflowHome,
          },
          ...(signal ? { cancelSignal: signal, gracefulCancel: true } : {}),
        })

        let rawOutput: string
        let stderrOutput = ''
        if (stream && subprocess.stdout) {
          // Capture stderr in parallel for error detection
          collectStderr(subprocess, s => { stderrOutput = s })
          rawOutput = await streamOutput(subprocess, onChunk)
        } else {
          const result = await subprocess
          rawOutput = result.stdout
          stderrOutput = result.stderr ?? ''
        }

        const durationMs = Date.now() - startTime
        const parsed = parseOutput(rawOutput)

        // iflow may exit 0 but output errors to stderr with empty stdout
        if (!parsed.response && stderrOutput) {
          const stderrParsed = parseOutput(stderrOutput)
          if (stderrParsed.response) {
            logger.warn(`iflow returned error via stderr: ${stderrParsed.response.slice(0, 200)}`)
            return err({ type: 'process', message: stderrParsed.response })
          }
        }

        logger.info(`完成 (${(durationMs / 1000).toFixed(1)}s)`)

        return ok({
          prompt: rawPrompt,
          response: parsed.response,
          durationMs,
          sessionId: parsed.sessionId,
        })
      } catch (error: unknown) {
        if (signal?.aborted) {
          return err({ type: 'cancelled', message: 'Chat interrupted by new message' })
        }
        return err(toInvokeError(error, 'iflow-cli'))
      }
    },

    async checkAvailable(): Promise<boolean> {
      try {
        // 设置 iflow 用户目录，与 invoke 保持一致
        const iflowHome = process.env.IFLOW_HOME || join(DATA_DIR, 'iflow')
        await execa('iflow', ['--version'], {
          timeout: 5000,
          env: {
            ...process.env,
            IFLOW_HOME: iflowHome,
          },
        })
        return true
      } catch (e) {
        logger.debug(`iflow not available: ${getErrorMessage(e)}`)
        return false
      }
    },
  }
}

// ============ Private Helpers ============

function buildArgs(prompt: string, model?: string, sessionId?: string, skipPermissions?: boolean): string[] {
  const args: string[] = []

  // 恢复会话
  if (sessionId) {
    args.push('-r', sessionId)
  }

  // 非交互模式
  args.push('-p', prompt)

  // 自动确认（YOLO mode）
  if (skipPermissions) {
    args.push('-y')
  }

  if (model) {
    args.push('-m', model)
  }

  return args
}

/**
 * 解析 iflow 输出
 *
 * iflow stdout 格式：
 *   回答内容
 *
 *   <Execution Info>
 *   { "session-id": "...", "tokenUsage": {...}, ... }
 *   </Execution Info>
 */
function parseOutput(raw: string): { response: string; sessionId: string } {
  const execInfoMatch = raw.match(/<Execution Info>\s*([\s\S]*?)\s*<\/Execution Info>/)

  let sessionId = ''
  if (execInfoMatch) {
    try {
      const info = JSON.parse(execInfoMatch[1]!)
      sessionId = info['session-id'] ?? ''
    } catch (e) {
      logger.debug(`Failed to parse Execution Info JSON: ${getErrorMessage(e)}`)
    }
  }

  // 回答是 <Execution Info> 之前的部分
  const response = execInfoMatch ? raw.slice(0, execInfoMatch.index).trim() : raw.trim()

  return { response, sessionId }
}

async function streamOutput(
  subprocess: ResultPromise,
  onChunk?: (chunk: string) => void
): Promise<string> {
  // iflow outputs plain text — no JSON parsing needed, raw passthrough
  return collectStream(subprocess, { onChunk })
}

