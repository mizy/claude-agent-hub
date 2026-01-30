import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
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

function buildPlanPrompt(agent: any, task: any): string {
  return `
你是 ${agent.name}，一个 ${agent.persona} 风格的开发者。

请为以下任务制定详细的执行计划：

## 任务
标题: ${task.title}
描述: ${task.description || '无'}
优先级: ${task.priority}

## 要求
1. 分析任务需求
2. 列出需要修改/创建的文件
3. 制定具体的实施步骤
4. 考虑可能的风险和应对方案

请以 JSON 格式返回计划:
{
  "analysis": "需求分析",
  "files": ["file1.ts", "file2.ts"],
  "steps": [
    {"order": 1, "action": "描述", "files": ["file.ts"]}
  ],
  "risks": ["风险1"],
  "estimatedEffort": "small|medium|large"
}
`
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
