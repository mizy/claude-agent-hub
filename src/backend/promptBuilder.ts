/**
 * Prompt 组装
 *
 * 将 agent system prompt + mode 指令拆分为 systemPrompt，用户 prompt 保持独立
 * 支持 claude-code --append-system-prompt 原生注入
 */

import type { AgentConfig } from '../types/agent.js'

const modeInstructions: Record<string, string> = {
  plan: '你现在处于计划模式，请分析任务并生成详细的执行计划。',
  execute: '你现在处于执行模式，请根据计划直接修改代码。',
  review: '你现在处于审查模式，请仔细审查代码变更并提出建议。',
}

export interface BuiltPrompt {
  systemPrompt: string
  userPrompt: string
}

/**
 * Split agent/mode system context from user prompt.
 * - systemPrompt: agent.systemPrompt + modeInstructions (for --append-system-prompt)
 * - userPrompt: the original user prompt, unchanged
 */
export function buildPrompt(prompt: string, agent?: AgentConfig, mode?: string): BuiltPrompt {
  const systemParts: string[] = []

  if (agent?.systemPrompt) {
    systemParts.push(agent.systemPrompt)
  }

  if (mode && modeInstructions[mode]) {
    systemParts.push(modeInstructions[mode])
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    userPrompt: prompt,
  }
}
