import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
import { buildPlanPrompt } from '../prompts/index.js'
import type { AgentContext } from '../types/agent.js'
import type { Plan } from '../types/plan.js'

/**
 * 根据任务生成执行计划
 */
export async function generatePlan(context: AgentContext): Promise<Plan> {
  const { agent, task } = context

  const prompt = buildPlanPrompt(agent, task)

  const response = await invokeClaudeCode({
    prompt,
    mode: 'plan',
    persona: agent.personaConfig
  })

  // 解析 Claude 返回的计划
  const plan = parsePlanResponse(response)

  return plan
}

function parsePlanResponse(response: string): Plan {
  // 提取 JSON 部分
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('无法解析计划响应')
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      id: crypto.randomUUID(),
      analysis: parsed.analysis || '',
      files: parsed.files || [],
      steps: parsed.steps || [],
      risks: parsed.risks || [],
      estimatedEffort: parsed.estimatedEffort || 'medium',
      createdAt: new Date().toISOString()
    }
  } catch {
    throw new Error('计划 JSON 解析失败')
  }
}
