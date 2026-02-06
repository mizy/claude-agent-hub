/**
 * Prompt 组装
 *
 * 将 persona system prompt + mode 指令 + 用户 prompt 拼接为完整 prompt
 * 此逻辑与具体后端无关
 */

import type { PersonaConfig } from '../types/persona.js'

const modeInstructions: Record<string, string> = {
  plan: '你现在处于计划模式，请分析任务并生成详细的执行计划。',
  execute: '你现在处于执行模式，请根据计划直接修改代码。',
  review: '你现在处于审查模式，请仔细审查代码变更并提出建议。',
}

export function buildPrompt(prompt: string, persona?: PersonaConfig, mode?: string): string {
  const parts: string[] = []

  if (persona?.systemPrompt) {
    parts.push(persona.systemPrompt, '')
  }

  if (mode && modeInstructions[mode]) {
    parts.push(modeInstructions[mode], '')
  }

  parts.push(prompt)
  return parts.join('\n')
}
