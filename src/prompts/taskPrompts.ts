/**
 * 任务相关 Prompt 定义
 */

import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { Workflow } from '../workflow/types.js'

/**
 * 获取当前时间字符串
 */
function getCurrentTime(): string {
  const now = new Date()
  return now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const TASK_PROMPTS = {
  /**
   * 执行 Workflow 节点的 prompt 模板
   */
  EXECUTE_NODE: `
你是 {{agentName}}，正在执行工作流 "{{workflowName}}" 的节点。

## 当前时间
{{currentTime}}

## 工作目录
{{cwd}}

## 当前节点
名称: {{nodeName}}
任务: {{nodePrompt}}

## 上下文
{{context}}

请执行这个节点的任务，直接修改相关文件。
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

  /**
   * 生成 JSON Workflow 的 prompt 模板
   */
  GENERATE_JSON_WORKFLOW: `
你是 {{agentName}}，一个 {{persona}} 风格的开发者。

## 当前时间
{{currentTime}}

## 工作目录
{{cwd}}

请为以下任务制定详细的执行计划，以 JSON 格式输出 Workflow 定义：

## 任务
标题: {{taskTitle}}
描述: {{taskDescription}}
优先级: {{priority}}

## 可用节点类型

1. **task** - 执行任务节点
   \`\`\`json
   { "id": "唯一ID", "type": "task", "name": "节点名称", "task": { "agent": "auto", "prompt": "任务描述" } }
   \`\`\`
   agent 可选值: {{availableAgents}}

2. **delay** - 延迟节点
   \`\`\`json
   { "id": "唯一ID", "type": "delay", "name": "等待", "delay": { "value": 5, "unit": "s" } }
   \`\`\`
   unit 可选: s(秒), m(分), h(时), d(天)

3. **human** - 人工审批节点（仅在任务明确要求人工审核时使用，默认不使用）
   \`\`\`json
   { "id": "唯一ID", "type": "human", "name": "审核", "human": { "timeout": 86400000 } }
   \`\`\`
   ⚠️ 除非任务明确要求人工介入，否则不要使用此节点，工作流应全自动完成

4. **switch** - 条件分支节点
   \`\`\`json
   { "id": "唯一ID", "type": "switch", "name": "判断", "switch": {
     "expression": "outputs.check.result",
     "cases": [
       { "value": "success", "targetNode": "success-node" },
       { "value": "default", "targetNode": "fallback-node" }
     ]
   }}
   \`\`\`

5. **assign** - 变量赋值节点
   \`\`\`json
   { "id": "唯一ID", "type": "assign", "name": "初始化", "assign": {
     "assignments": [
       { "variable": "count", "value": 0 },
       { "variable": "name", "value": "outputs.prev.name", "isExpression": true }
     ]
   }}
   \`\`\`

6. **script** - 表达式计算节点
   \`\`\`json
   { "id": "唯一ID", "type": "script", "name": "计算", "script": {
     "expression": "variables.count + 1",
     "outputVar": "count"
   }}
   \`\`\`

7. **loop** - 循环节点
   \`\`\`json
   { "id": "唯一ID", "type": "loop", "name": "循环处理", "loop": {
     "type": "while",
     "condition": "variables.count < 10",
     "maxIterations": 100,
     "bodyNodes": ["process-node"]
   }}
   \`\`\`

8. **foreach** - 遍历节点
   \`\`\`json
   { "id": "唯一ID", "type": "foreach", "name": "遍历处理", "foreach": {
     "collection": "outputs.list.items",
     "itemVar": "item",
     "bodyNodes": ["process-item"],
     "mode": "sequential"
   }}
   \`\`\`

## 输出格式

请严格按照以下 JSON 格式输出：

\`\`\`json
{
  "name": "工作流名称",
  "description": "工作流描述",
  "nodes": [
    { "id": "start", "type": "start", "name": "开始" },
    // ... 你的节点定义
    { "id": "end", "type": "end", "name": "结束" }
  ],
  "edges": [
    { "from": "start", "to": "first-node" },
    // ... 节点连接
    { "from": "last-node", "to": "end" }
  ],
  "variables": {
    // 初始变量（可选）
  }
}
\`\`\`

## 表达式语法

在条件和脚本中可以使用：
- \`outputs.nodeId.xxx\` - 访问节点输出
- \`variables.xxx\` - 访问变量
- \`len(array)\` - 数组长度
- \`&&\` / \`||\` - 逻辑运算
- 数学运算: +, -, *, /

## 规则
1. 每个节点必须有唯一的 id
2. edges 定义节点之间的连接关系
3. 条件边使用 condition 属性
4. 只输出 JSON，不要有其他文字

现在请生成 JSON Workflow：
`,
}

/**
 * 构建生成 JSON Workflow 的 prompt
 */
export function buildJsonWorkflowPrompt(
  agent: Agent,
  task: Task,
  availableAgents: string[] = []
): string {
  // 构建可用 agent 列表说明
  const agentList = availableAgents.length > 0
    ? `"auto" (自动选择) 或具体名称: ${availableAgents.map(a => `"${a}"`).join(', ')}`
    : '"auto" (使用默认 agent)'

  return TASK_PROMPTS.GENERATE_JSON_WORKFLOW
    .replace('{{currentTime}}', getCurrentTime())
    .replace('{{cwd}}', process.cwd())
    .replace('{{agentName}}', agent.name)
    .replace('{{persona}}', agent.persona)
    .replace('{{taskTitle}}', task.title)
    .replace('{{taskDescription}}', task.description || '无')
    .replace('{{priority}}', task.priority)
    .replace('{{availableAgents}}', agentList)
}

/**
 * 构建执行节点的 prompt
 */
export function buildExecuteNodePrompt(
  agent: Agent,
  workflow: Workflow,
  nodeName: string,
  nodePrompt: string,
  context: string = ''
): string {
  return TASK_PROMPTS.EXECUTE_NODE
    .replace('{{currentTime}}', getCurrentTime())
    .replace('{{cwd}}', process.cwd())
    .replace('{{agentName}}', agent.name)
    .replace('{{workflowName}}', workflow.name)
    .replace('{{nodeName}}', nodeName)
    .replace('{{nodePrompt}}', nodePrompt)
    .replace('{{context}}', context || '无上下文')
}

/**
 * 构建生成标题的 prompt (workflow 版本)
 */
export function buildGenerateTitleFromWorkflowPrompt(task: Task, workflow: Workflow): string {
  const taskNodes = workflow.nodes.filter(n => n.type === 'task')
  const steps = taskNodes.map(n => `- ${n.name}`).join('\n')

  return TASK_PROMPTS.GENERATE_TITLE
    .replace('{{description}}', task.description || '(No description)')
    .replace('{{analysis}}', workflow.description || '')
    .replace('{{steps}}', steps)
}
