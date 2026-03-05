/**
 * 任务相关 Prompt 定义
 */

import type { PersonaConfig } from '../types/persona.js'
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

1. **单一职责**：每个节点只做一件事，职责明确
2. **原子性**：每个节点要么完全成功，要么完全失败，便于重试
3. **顺序依赖**：有依赖关系的任务串行，无依赖的并行（见下方"并行执行"）
4. **合理粒度**：
   - **简单任务**（Git 提交、单文件修改）：2-3 个 task 节点
   - **中等任务**（功能开发、重构）：4-6 个 task 节点
   - **复杂任务**（多模块改动、迭代开发）：7-10 个 task 节点

## 节点合并原则（避免过度拆分）

以下场景合并为单个节点：
- **Git 提交**：analyze-changes → commit-and-verify（2 节点），不要拆成 5 步
- **迭代+文档**：每个迭代节点内包含相关文档更新，不要分开
- **验证类**：typecheck、lint、test 合并为单个 verify 节点

保持独立的节点：代码修改核心逻辑、风险操作（发布/部署）、需要人工确认的步骤

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

请为以下任务制定执行计划：

## 任务
标题: {{taskTitle}}
描述: {{taskDescription}}
优先级: {{priority}}

---

## 可用节点类型

1. **task** - AI 执行任务
   \`\`\`json
   { "id": "node_id", "type": "task", "name": "节点名称", "task": { "persona": "auto", "prompt": "任务描述" } }
   \`\`\`

2. **lark-notify** - 飞书通知（直接调用 API，不经过 AI）
   \`\`\`json
   { "id": "notify", "type": "lark-notify", "name": "推送飞书", "larkNotify": { "content": "outputs.report._raw", "title": "标题" } }
   \`\`\`
   ⚠️ **凡是需要推送飞书消息，必须用此节点**，task 节点无法实际发送消息。省略 content 则自动取最近完成节点输出。

3. **schedule-wait** - 定时等待（配合 loop-back edge 实现周期任务）
   \`\`\`json
   { "id": "wait", "type": "schedule-wait", "name": "等待下次", "scheduleWait": { "cron": "0 9 * * 1-5" } }
   \`\`\`
   cron 为标准 5 字段表达式，最小间隔 30 秒。执行时状态变为 waiting，不占用 worker。

4. **human** - 人工审批（仅任务明确要求时使用）
   \`\`\`json
   { "id": "approve", "type": "human", "name": "人工审核", "human": { "timeout": 86400000 } }
   \`\`\`

5. **delay** - 固定延迟
   \`\`\`json
   { "id": "wait", "type": "delay", "name": "等待", "delay": { "value": 5, "unit": "s" } }
   \`\`\`
   unit: s / m / h / d

6. **switch** - 多路条件分支（3 个及以上分支时使用；2 路分支优先用条件边）
   \`\`\`json
   { "id": "branch", "type": "switch", "name": "分支", "switch": {
     "expression": "outputs.check._raw",
     "cases": [
       { "value": "success", "targetNode": "deploy" },
       { "value": "warning", "targetNode": "notify" },
       { "value": "default", "targetNode": "rollback" }
     ]
   }}
   \`\`\`

7. **assign** - 变量赋值
   \`\`\`json
   { "id": "init", "type": "assign", "name": "初始化", "assign": {
     "assignments": [
       { "variable": "count", "value": 0 },
       { "variable": "name", "value": "outputs.prev._raw", "isExpression": true }
     ]
   }}
   \`\`\`

8. **script** - 表达式计算
   \`\`\`json
   { "id": "calc", "type": "script", "name": "计算", "script": { "expression": "variables.count + 1", "outputVar": "count" } }
   \`\`\`

9. **loop** - 条件循环
   \`\`\`json
   { "id": "loop", "type": "loop", "name": "循环", "loop": { "type": "while", "condition": "variables.count < 10", "maxIterations": 100, "bodyNodes": ["process"] } }
   \`\`\`

10. **foreach** - 集合遍历
    \`\`\`json
    { "id": "each", "type": "foreach", "name": "遍历", "foreach": { "collection": "outputs.list.items", "itemVar": "item", "bodyNodes": ["process_item"], "mode": "sequential" } }
    \`\`\`

---

## 边（Edge）

**无条件边**：普通连接
\`\`\`json
{ "from": "a", "to": "b" }
\`\`\`

**条件边**：condition 为 true 时走这条边
\`\`\`json
{ "from": "review", "to": "end", "condition": "outputs.review._raw.includes('APPROVED')" }
\`\`\`

**loop-back 边**：循环回跳，配合 maxLoops 防止死循环
\`\`\`json
{ "from": "fix", "to": "verify", "maxLoops": 3 }
\`\`\`

**并行执行**：从同一节点出发多条无条件边 → 引擎自动并发执行目标节点
\`\`\`json
{ "from": "start", "to": "task_a" },
{ "from": "start", "to": "task_b" }
\`\`\`
两条分支都完成后，下游节点才会执行（自动 join）。

---

## 常用模式

### Review-Fix 循环（功能开发/重构必用）

\`\`\`
implement → verify → review → end (APPROVED)
                       ↓ (!APPROVED)
                      fix → verify (maxLoops=3)
\`\`\`

规则：
- verify（构建验证）在 review（代码评审）之前，先确保 build 通过
- review → end 是 APPROVED 条件边；review → fix 是 !APPROVED 条件边
- **APPROVED 边放前，!APPROVED 边放后**（后者作为 fallback）
- fix → verify 设 maxLoops=3；fix 只回 verify，不直接回 review
- build 失败由 verify 节点 retry 处理，不需要 verify → fix 的条件分支

\`\`\`json
{
  "nodes": [
    { "id": "start", "type": "start", "name": "开始" },
    { "id": "implement", "type": "task", "name": "实现功能", "task": { "persona": "Pragmatist", "prompt": "实现 xxx 功能" } },
    { "id": "verify", "type": "task", "name": "构建验证", "task": { "persona": "Tester", "prompt": "运行 typecheck、lint、build、test，有失败先修复再验证。" } },
    { "id": "review", "type": "task", "name": "代码评审", "task": { "persona": "Reviewer", "prompt": "严格评审代码变更，逐项检查正确性、代码质量、架构、错误处理、性能、安全。\\n\\n输出结论：APPROVED（零🔴问题）、NEEDS_CHANGES（有🔴必须修复项）或 REJECTED（架构性问题需重写）。按 🔴/🟡/🟢 分级列出问题。" } },
    { "id": "fix", "type": "task", "name": "修复问题", "task": { "persona": "Pragmatist", "prompt": "根据评审意见修复代码问题" } },
    { "id": "end", "type": "end", "name": "结束" }
  ],
  "edges": [
    { "from": "start", "to": "implement" },
    { "from": "implement", "to": "verify" },
    { "from": "verify", "to": "review" },
    { "from": "review", "to": "end", "condition": "outputs.review._raw.includes('APPROVED')" },
    { "from": "review", "to": "fix", "condition": "!outputs.review._raw.includes('APPROVED')" },
    { "from": "fix", "to": "verify", "maxLoops": 3 }
  ]
}
\`\`\`

何时使用：核心功能开发、重构、涉及安全/性能的修改
何时不用：配置修改、文档更新、Git 提交、2-3 节点的简单任务

### 周期任务（schedule-wait + loop-back）

大多数周期任务是**无限循环**，无需 end 节点（用户手动停止）：

\`\`\`json
{
  "nodes": [
    { "id": "start", "type": "start", "name": "开始" },
    { "id": "execute", "type": "task", "name": "执行任务", "task": { "persona": "Pragmatist", "prompt": "执行检查/分析..." } },
    { "id": "notify", "type": "lark-notify", "name": "推送结果", "larkNotify": { "title": "定时报告" } },
    { "id": "wait", "type": "schedule-wait", "name": "等待下次", "scheduleWait": { "cron": "0 9 * * 1-5" } }
  ],
  "edges": [
    { "from": "start", "to": "execute" },
    { "from": "execute", "to": "notify" },
    { "from": "notify", "to": "wait" },
    { "from": "wait", "to": "execute", "maxLoops": 500 }
  ]
}
\`\`\`

---

## 输出格式

\`\`\`json
{
  "name": "工作流名称",
  "description": "工作流描述",
  "nodes": [
    { "id": "start", "type": "start", "name": "开始" },
    { "id": "end", "type": "end", "name": "结束" }
  ],
  "edges": [
    { "from": "start", "to": "first_node" },
    { "from": "last_node", "to": "end" }
  ]
}
\`\`\`

## 表达式语法

- \`outputs.node_id._raw\` — 节点原始文本输出（**最常用**）
- \`outputs.node_id._raw.includes('xxx')\` — 检查关键字
- ⚠️ \`outputs.node_id.result\` 不存在，始终用 \`_raw\`
- \`variables.xxx\` — 访问变量
- \`startsWith(str, prefix)\` / \`lower(str)\` / \`upper(str)\`
- \`len(array)\` / \`has(obj, key)\`
- \`&&\` / \`||\` / 数学运算 +, -, *, /

## 规则

1. 每个节点必须有唯一 id，**使用下划线分隔**（如 \`analyze_changes\`），避免连字符（条件表达式中连字符会被转为下划线，容易出错）
2. edges 定义节点连接；条件边用 condition，loop-back 用 maxLoops
3. review 节点 prompt 必须要求输出 APPROVED / NEEDS_CHANGES / REJECTED
4. **条件边顺序**：肯定条件（APPROVED → end）放前，否定条件（!APPROVED → fix）放后作为 fallback；引擎在所有条件为 false 时走最后一条边
5. **可达性**：从 start 沿非 loop-back 边必须能到达 end（周期任务例外，可无 end）
6. {{outputInstruction}}

现在请生成 JSON Workflow：
`,
}

/**
 * 构建 Persona 描述列表
 */
function formatPersonaDescriptions(personas: PersonaConfig[]): string {
  if (personas.length === 0) {
    return '- 无可用 Persona，使用 "auto" 自动选择默认 Persona'
  }

  return personas
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
  availablePersonas: PersonaConfig[] = [],
  projectContext: string = '',
  learningInsights: string = '',
  useAgentTeams: boolean = false,
  memoryContext: string = ''
): string {
  const personaDescriptions = formatPersonaDescriptions(availablePersonas)
  const agentTeamsInstruction = useAgentTeams ? AGENT_TEAMS_INSTRUCTION : ''
  const outputInstruction = useAgentTeams
    ? '先输出团队讨论过程，最后输出 JSON（JSON 放在所有文字之后）'
    : '只输出 JSON，不要有其他文字'

  // 生成 Workflow 固定使用"软件架构师"角色，不受 persona 参数影响
  return TASK_PROMPTS.GENERATE_JSON_WORKFLOW.replace('{{currentTime}}', getCurrentTime())
    .replace('{{cwd}}', process.cwd())
    .replace('{{taskTitle}}', task.title)
    .replace('{{taskDescription}}', task.description || '无')
    .replace('{{priority}}', task.priority)
    .replace('{{agentDescriptions}}', personaDescriptions)
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
  persona: PersonaConfig,
  workflow: Workflow,
  nodeName: string,
  nodePrompt: string,
  context: string = ''
): string {
  return TASK_PROMPTS.EXECUTE_NODE.replace('{{currentTime}}', getCurrentTime())
    .replace('{{cwd}}', process.cwd())
    .replace('{{agentName}}', persona.name)
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
