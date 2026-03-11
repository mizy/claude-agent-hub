/**
 * 任务相关 Prompt 定义
 */

import type { AgentConfig } from '../types/agent.js'
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

## 输出规范
- 语言：跟随工作流名称和节点任务描述的语言（中文任务用中文回复，英文任务用英文回复）
- 长度：只输出关键结论和变更摘要，省略过程推导。内部分析节点控制在 50 行以内
- 格式限制（输出可能展示在飞书卡片中，以下格式不被支持）：
  - 禁用 markdown 表格（| col | 语法），改用列表或缩进文本
  - 禁用反引号包裹的行内代码，直接写代码名称即可
  - 禁用 ### 及更深层标题，只用 **粗体** 做小节标题
  - 可以使用：**粗体**、*斜体*、~~删除线~~、有序/无序列表、代码块（三个反引号包裹）

## 上下文
{{context}}

请执行这个节点的任务，直接修改相关文件。

⚠️ **严禁执行 cah restart、cah stop 或任何 kill/终止进程的命令** — 这些操作会直接终止正在运行的 daemon，破坏整个执行环境。代码构建后由 stale_daemon 检测机制在安全时机自动重启。
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
   * 支持项目上下文和历史学习
   */
  GENERATE_JSON_WORKFLOW: `
你是一位软件架构师，负责将任务拆分为可独立执行的子任务，并分配给合适的 agent。

{{agentTeamsInstruction}}

## 任务拆分原则

- **单一职责 + 原子性**：每个节点只做一件事，要么成功要么失败
- **合理粒度**：简单任务 2-3 节点，中等 4-6 节点，复杂 7-10 节点
- **合并原则**：Git 操作合并为 2 节点；typecheck/lint/test 合并为单个 verify 节点；迭代节点内含文档更新
- **保持独立**：核心逻辑修改、风险操作（发布/部署）、人工确认步骤

## 可用 Agent

{{agentDescriptions}}

{{projectContext}}

{{learningInsights}}

{{memoryContext}}

## 当前时间
{{currentTime}}

## 工作目录
{{cwd}}

---

## 任务
标题: {{taskTitle}}
描述: {{taskDescription}}
优先级: {{priority}}

---

## 节点类型

**核心节点**（最常用）：
- **task**: \`{ "id": "xxx", "type": "task", "name": "名称", "task": { "agent": "auto", "prompt": "描述" } }\` — 可选 \`task.backend\`/\`task.model\` 覆盖全局设置
- **lark-notify**: \`{ "id": "notify", "type": "lark-notify", "name": "推送飞书", "larkNotify": { "title": "标题" } }\` — ⚠️ 推送飞书必须用此节点，task 节点无法发消息。省略 content 自动取最近完成节点输出
- **schedule-wait**: \`{ "id": "wait", "type": "schedule-wait", "name": "等待", "scheduleWait": { "cron": "0 9 * * 1-5" } }\` — 5 字段 cron，最小间隔 30s

**辅助节点**（按需使用）：
- **human**: \`{ ..., "human": { "timeout": 86400000 } }\` — 人工审批
- **delay**: \`{ ..., "delay": { "value": 5, "unit": "s" } }\` — 固定延迟（s/m/h/d）
- **switch**: \`{ ..., "switch": { "expression": "outputs.x._raw", "cases": [{ "value": "v", "targetNode": "id" }, { "value": "default", "targetNode": "id" }] } }\`
- **assign**: \`{ ..., "assign": { "assignments": [{ "variable": "name", "value": 0 }] } }\` — isExpression:true 时 value 为表达式
- **script**: \`{ ..., "script": { "expression": "variables.count + 1", "outputVar": "count" } }\`
- **loop**: \`{ ..., "loop": { "type": "while", "condition": "expr", "maxIterations": 100, "bodyNodes": ["id"] } }\`
- **foreach**: \`{ ..., "foreach": { "collection": "outputs.x.items", "itemVar": "item", "bodyNodes": ["id"], "mode": "sequential" } }\`

## 边（Edge）

- 无条件边：\`{ "from": "a", "to": "b" }\`
- 条件边：\`{ "from": "a", "to": "b", "condition": "outputs.a._raw.includes('APPROVED')" }\`
- loop-back 边：\`{ "from": "a", "to": "b", "maxLoops": 5 }\`
- 并行：同一节点多条无条件出边 → 引擎自动并发，全部完成后下游才执行

## 常用模式

**Review-Fix 循环**（功能开发/重构必用）：
\`\`\`
implement → review →(APPROVED)→ end/后续节点
                ↓ (fallback，无 condition)
               fix → review (maxLoops=5)
\`\`\`
关键规则：
- review 节点先跑 build/test 再评审，prompt 要求输出 APPROVED/NEEDS_CHANGES/REJECTED
- APPROVED 条件边放前，无条件 fallback 边放后（引擎按顺序匹配）
- 同一节点只能有一条 APPROVED 出边
- APPROVED 后有后续节点时，条件边指向后续节点（不是 end）

边示例：
\`\`\`json
{ "from": "review", "to": "end", "condition": "outputs.review._raw.includes('APPROVED')" },
{ "from": "review", "to": "fix" },
{ "from": "fix", "to": "review", "maxLoops": 5 }
\`\`\`

**多模块并行 Review-Fix**（多模块审查/修复）：
- 每模块独立 review→fix→verify 链，从 start 并行展开
- verify 通过(✅)→汇聚到 report 节点，失败(❌)→loop-back 回 review（maxLoops:5）
- id 命名：review_xxx / fix_xxx / verify_xxx

**周期任务**（schedule-wait + loop-back，通常无 end）：
\`\`\`
start → execute → notify → wait →(maxLoops:500)→ execute
\`\`\`

## 输出格式

\`\`\`json
{ "name": "名称", "description": "描述", "nodes": [...], "edges": [...] }
\`\`\`
每个 workflow 必须有 start 节点；非周期任务必须有 end 节点。

## 表达式

- \`outputs.node_id._raw\` — 节点原始输出（⚠️ 始终用 _raw，不存在 .result）
- \`outputs.node_id._raw.includes('xxx')\` / \`variables.xxx\` / \`&&\` / \`||\`

## 规则

1. 节点 id 用**下划线分隔**（如 analyze_changes），避免连字符；**"start" 和 "end" 是保留 ID**，只能用于 type=start/end 的结构节点，task 节点严禁使用这两个 id（用 analyze、summarize、report 等代替）
2. review 节点 prompt 必须要求输出 APPROVED / NEEDS_CHANGES / REJECTED
3. **条件边顺序**：肯定条件放前，fallback 放后
4. **可达性**：从 start 沿非 loop-back 边必须能到达 end（周期任务例外）
5. **loop-back 与 fan-out**：当一个节点有多条并行出边（fan-out）时，loop-back 的目标节点必须是 fan-out 源头节点或其上游，不能指向并行分支中的某个节点。否则循环重置会扩散到其他并行分支，导致聚合节点混合新旧数据。标准模式：checkpoint → [A, B, C 并行] → aggregate → verify → loop-back 到 checkpoint
6. {{outputInstruction}}

现在请生成 JSON Workflow：
`,
}

/**
 * 构建 Agent 描述列表
 */
function formatAgentDescriptions(agents: AgentConfig[]): string {
  if (agents.length === 0) {
    return '- 无可用 Agent，使用 "auto" 自动选择默认 Agent'
  }

  return agents
    .map(p => {
      const desc = p.description ? `: ${p.description}` : ''
      return `- **${p.name}**${desc}`
    })
    .join('\n')
}

/**
 * Agent Teams 指令文本
 * 用于引导 Claude 使用 agent teams 协作生成更好的 workflow
 */
const AGENT_TEAMS_INSTRUCTION = `
## 🤝 协作模式：Agent Teams

请创建一个 agent team 协作设计工作流：

**团队成员：**
1. **Requirements Analyst** - 分析任务需求、项目上下文和潜在风险
2. **Workflow Architect** - 设计节点划分、依赖关系和执行顺序
3. **QA Reviewer** - 审查方案完整性、可靠性和最佳实践

**协作流程：**
1. Requirements Analyst 分析任务，识别关键要素和潜在问题
2. Workflow Architect 基于分析设计工作流结构
3. QA Reviewer 审查并提出优化建议
4. 讨论完善后，**最终输出 JSON workflow**（JSON 放在所有讨论内容之后）
`

/**
 * 构建生成 JSON Workflow 的 prompt
 * 支持项目上下文和历史学习
 */
export function buildJsonWorkflowPrompt(
  task: Task,
  availableAgents: AgentConfig[] = [],
  projectContext: string = '',
  learningInsights: string = '',
  useAgentTeams: boolean = false,
  memoryContext: string = ''
): string {
  const agentDescriptions = formatAgentDescriptions(availableAgents)
  const agentTeamsInstruction = useAgentTeams ? AGENT_TEAMS_INSTRUCTION : ''
  const outputInstruction = useAgentTeams
    ? '先输出团队讨论过程，最后输出 JSON（JSON 放在所有文字之后）'
    : '只输出 JSON，不要有其他文字'

  // 生成 Workflow 固定使用"软件架构师"角色，不受 agent 参数影响
  return TASK_PROMPTS.GENERATE_JSON_WORKFLOW.replace('{{currentTime}}', getCurrentTime())
    .replace('{{cwd}}', process.cwd())
    .replace('{{taskTitle}}', task.title)
    .replace('{{taskDescription}}', task.description || '无')
    .replace('{{priority}}', task.priority)
    .replace('{{agentDescriptions}}', agentDescriptions)
    .replace('{{projectContext}}', projectContext)
    .replace('{{learningInsights}}', learningInsights)
    .replace('{{memoryContext}}', memoryContext)
    .replace('{{agentTeamsInstruction}}', agentTeamsInstruction)
    .replace('{{outputInstruction}}', outputInstruction)
}

/**
 * 构建执行节点的 prompt
 */
export function buildExecuteNodePrompt(
  agent: AgentConfig,
  workflow: Workflow,
  nodeName: string,
  nodePrompt: string,
  context: string = ''
): string {
  return TASK_PROMPTS.EXECUTE_NODE.replace('{{currentTime}}', getCurrentTime())
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

  return TASK_PROMPTS.GENERATE_TITLE.replace(
    '{{description}}',
    task.description || '(No description)'
  )
    .replace('{{analysis}}', workflow.description || '')
    .replace('{{steps}}', steps)
}
