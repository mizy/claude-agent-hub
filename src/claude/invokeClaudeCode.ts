import { execa } from 'execa'
import type { PersonaConfig } from '../types/persona.js'

interface InvokeOptions {
  prompt: string
  mode: 'plan' | 'execute' | 'review'
  persona?: PersonaConfig
  allowedTools?: string[]
  cwd?: string
}

interface InvokeResult {
  output: string
  exitCode: number
}

/**
 * 调用 Claude Code CLI 执行任务
 */
export async function invokeClaudeCode(options: InvokeOptions): Promise<string> {
  const { prompt, mode, persona, allowedTools, cwd } = options

  // 构建完整的 prompt，包含人格设定
  const fullPrompt = buildFullPrompt(prompt, persona, mode)

  // 构建 claude 命令参数
  const args = ['--print', '--dangerously-skip-permissions']

  // 添加 prompt
  args.push(fullPrompt)

  try {
    const result = await execa('claude', args, {
      cwd: cwd || process.cwd(),
      timeout: 30 * 60 * 1000, // 30 分钟超时
      env: {
        ...process.env,
        // 可以传递额外的环境变量
      }
    })

    return result.stdout
  } catch (error: any) {
    if (error.timedOut) {
      throw new Error('Claude Code 执行超时')
    }
    throw new Error(`Claude Code 执行失败: ${error.message}`)
  }
}

function buildFullPrompt(
  prompt: string,
  persona?: PersonaConfig,
  mode?: string
): string {
  const parts: string[] = []

  // 添加人格 system prompt
  if (persona?.systemPrompt) {
    parts.push(persona.systemPrompt)
    parts.push('')
  }

  // 添加模式特定指令
  if (mode === 'plan') {
    parts.push('你现在处于计划模式，请分析任务并生成详细的执行计划。')
    parts.push('')
  } else if (mode === 'execute') {
    parts.push('你现在处于执行模式，请根据计划直接修改代码。')
    parts.push('')
  } else if (mode === 'review') {
    parts.push('你现在处于审查模式，请仔细审查代码变更并提出建议。')
    parts.push('')
  }

  // 添加主 prompt
  parts.push(prompt)

  return parts.join('\n')
}

/**
 * 检查 Claude Code CLI 是否可用
 */
export async function checkClaudeCodeAvailable(): Promise<boolean> {
  try {
    await execa('claude', ['--version'])
    return true
  } catch {
    return false
  }
}
