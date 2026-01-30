/**
 * 任务相关 Prompt 定义
 */

import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { Plan, PlanStep } from '../types/plan.js'

export const TASK_PROMPTS = {
  /**
   * 生成执行计划的 prompt 模板
   */
  GENERATE_PLAN: `
你是 {{agentName}}，一个 {{persona}} 风格的开发者。

## 工作目录
{{cwd}}

请为以下任务制定详细的执行计划：

## 任务
标题: {{taskTitle}}
描述: {{taskDescription}}
优先级: {{priority}}

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
`,

  /**
   * 执行单个步骤的 prompt 模板
   */
  EXECUTE_STEP: `
你是 {{agentName}}，正在执行任务 "{{taskTitle}}" 的第 {{stepOrder}} 步。

## 工作目录
{{cwd}}

## 当前步骤
{{stepAction}}

## 涉及文件
{{stepFiles}}

请执行这一步骤，直接修改相关文件。
`,

  /**
   * 生成任务标题的 prompt 模板
   */
  GENERATE_TITLE: `Based on the following task description and execution plan, generate a concise, descriptive title (max 50 characters).

## Task Description
{{description}}

## Execution Plan Analysis
{{analysis}}

## Steps
{{steps}}

Return ONLY the title text, nothing else. Use the same language as the content (Chinese if content is in Chinese, English if in English).`,
}

/**
 * 构建生成计划的 prompt
 */
export function buildPlanPrompt(agent: Agent, task: Task): string {
  return TASK_PROMPTS.GENERATE_PLAN
    .replace('{{cwd}}', process.cwd())
    .replace('{{agentName}}', agent.name)
    .replace('{{persona}}', agent.persona)
    .replace('{{taskTitle}}', task.title)
    .replace('{{taskDescription}}', task.description || '无')
    .replace('{{priority}}', task.priority)
}

/**
 * 构建执行步骤的 prompt
 */
export function buildExecuteStepPrompt(agent: Agent, task: Task, step: PlanStep): string {
  return TASK_PROMPTS.EXECUTE_STEP
    .replace('{{cwd}}', process.cwd())
    .replace('{{agentName}}', agent.name)
    .replace('{{taskTitle}}', task.title)
    .replace('{{stepOrder}}', String(step.order))
    .replace('{{stepAction}}', step.action)
    .replace('{{stepFiles}}', step.files.join('\n'))
}

/**
 * 构建生成标题的 prompt
 */
export function buildGenerateTitlePrompt(task: Task, plan: Plan): string {
  return TASK_PROMPTS.GENERATE_TITLE
    .replace('{{description}}', task.description || '(No description)')
    .replace('{{analysis}}', plan.analysis)
    .replace('{{steps}}', plan.steps.map(s => `- ${s.action}`).join('\n'))
}
