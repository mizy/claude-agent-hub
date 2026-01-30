import { invokeClaudeCode } from '../claude/invokeClaudeCode.js'
import { commitChanges } from '../git/commitChanges.js'
import type { AgentContext } from '../types/agent.js'
import type { Plan, PlanStep } from '../types/plan.js'
import type { StepOutput } from '../types/output.js'

/**
 * 执行计划中的每个步骤
 * @returns 所有步骤的输出
 */
export async function executePlan(context: AgentContext, plan: Plan): Promise<StepOutput[]> {
  const { agent } = context
  const stepOutputs: StepOutput[] = []

  console.log(`[${agent.name}] 开始执行计划，共 ${plan.steps.length} 步`)

  for (const step of plan.steps) {
    console.log(`[${agent.name}] 执行步骤 ${step.order}: ${step.action}`)

    const stepOutput = await executeStep(context, step)
    stepOutputs.push(stepOutput)

    // 每步完成后提交
    await commitChanges({
      message: `[${agent.name}] Step ${step.order}: ${step.action}`,
      files: step.files
    })
  }

  console.log(`[${agent.name}] 计划执行完成`)
  return stepOutputs
}

async function executeStep(context: AgentContext, step: PlanStep): Promise<StepOutput> {
  const { agent, task } = context
  const startTime = Date.now()

  const prompt = `
你是 ${agent.name}，正在执行任务 "${task.title}" 的第 ${step.order} 步。

## 当前步骤
${step.action}

## 涉及文件
${step.files.join('\n')}

请执行这一步骤，直接修改相关文件。
`

  const output = await invokeClaudeCode({
    prompt,
    mode: 'execute',
    persona: agent.personaConfig,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep']
  })

  const durationMs = Date.now() - startTime

  return {
    stepOrder: step.order,
    action: step.action,
    files: step.files,
    output,
    durationMs,
  }
}
