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
2. **边界清晰**：节点之间通过明确的输入/输出交互，避免职责重叠
3. **原子性**：每个节点要么完全成功，要么完全失败，便于重试
4. **顺序依赖**：有依赖关系的任务串行执行，无依赖的可以并行
5. **合理粒度**：
   - 太粗：一个节点做太多事，难以定位问题
   - 太细：节点过多，增加协调成本
   - 建议：每个节点 5-15 分钟可完成的工作量

## 节点设计最佳实践（基于历史数据）

### 推荐的节点数量
- **简单任务**（如 Git 提交、单文件修改）：2-3 个 task 节点
- **中等任务**（如功能开发、重构）：5-7 个 task 节点
- **复杂任务**（如迭代开发、多模块改动）：8-10 个 task 节点

### 需要合并的节点模式
以下场景应该合并为单个节点，避免过度拆分：

1. **Git 提交流程**：不要拆分为 check-status → review → stage → commit → verify
   - 应合并为：analyze-changes → commit-and-verify（2 节点）

2. **迭代+文档更新**：不要将每次迭代和 changelog 分开
   - 应合并为：每个迭代节点内包含相关文档更新

3. **验证类任务**：typecheck、lint、test 可合并为单个验证节点

### 应该保持独立的节点
1. **代码修改类**：需要理解和修改代码的核心任务
2. **风险操作**：可能失败需要单独重试的操作（如发布、部署）
3. **需要人工确认的步骤**：前置条件验证

## 可用 Agent

{{agentDescriptions}}

{{projectContext}}

{{learningInsights}}

{{memoryContext}}

## 当前时间
{{currentTime}}

## 工作目录
{{cwd}}

请为以下任务制定执行计划，以 JSON 格式输出 Workflow：

## 任务
标题: {{taskTitle}}
描述: {{taskDescription}}
优先级: {{priority}}

## 可用节点类型

1. **task** - 执行任务节点
   \`\`\`json
   { "id": "唯一ID", "type": "task", "name": "节点名称", "task": { "agent": "auto", "prompt": "任务描述" } }
   \`\`\`

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
     "expression": "outputs.check._raw",
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

## 条件边与循环边

边（edge）支持 condition 和 maxLoops 属性，用于实现条件分支和循环：

\`\`\`json
{
  "from": "review", "to": "fix",
  "condition": "outputs.review.approved == false"
}
\`\`\`
- **condition**：表达式为 true 时走这条边，为 false 时跳过
- **maxLoops**：限制循环边最大执行次数，防止无限循环。超过次数后自动跳过该边

### Review-Fix 循环模式

对于需要质量保证的任务（功能开发、重构、复杂修改），推荐使用 review-fix 循环：

1. **开发节点**（Pragmatist persona）完成代码实现
2. **review 节点**（Reviewer persona）独立评审，输出中必须包含关键字 APPROVED 或 REJECTED
3. 通过条件边判断：APPROVED → 继续后续节点；REJECTED → 回到修复节点
4. 修复节点到 review 节点的边设置 maxLoops=3，防止无限循环

示例：
\`\`\`json
{
  "nodes": [
    { "id": "start", "type": "start", "name": "开始" },
    { "id": "implement", "type": "task", "name": "实现功能", "task": { "agent": "Pragmatist", "prompt": "实现 xxx 功能，完成后运行 typecheck 确认无误" } },
    { "id": "review", "type": "task", "name": "代码评审", "task": { "agent": "Reviewer", "prompt": "评审上一节点的代码变更。检查逻辑正确性、边界处理、代码风格。\\n\\n评审结果必须以 APPROVED 或 REJECTED 开头。如果 REJECTED，说明具体问题和修复建议。" } },
    { "id": "fix", "type": "task", "name": "修复问题", "task": { "agent": "Pragmatist", "prompt": "根据评审意见修复代码问题，修复后运行验证确认" } },
    { "id": "end", "type": "end", "name": "结束" }
  ],
  "edges": [
    { "from": "start", "to": "implement" },
    { "from": "implement", "to": "review" },
    { "from": "review", "to": "end", "condition": "outputs.review._raw.includes('APPROVED')" },
    { "from": "review", "to": "fix", "condition": "!outputs.review._raw.includes('APPROVED')" },
    { "from": "fix", "to": "review", "maxLoops": 3 }
  ]
}
\`\`\`

**何时使用 review-fix 循环：**
- 核心功能开发（逻辑复杂，容易出错）
- 重构（需要确保行为一致性）
- 涉及安全或性能的修改

**何时不需要：**
- 简单的配置修改、文档更新、Git 提交
- 2-3 个节点的简单任务

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
    // ... 节点连接（可添加 condition 和 maxLoops）
    { "from": "last-node", "to": "end" }
  ],
  "variables": {
    // 初始变量（可选）
  }
}
\`\`\`

## 表达式语法

在条件和脚本中可以使用：
- \`outputs.nodeId.xxx\` - 访问节点输出（结构化字段）
- \`outputs.nodeId._raw\` - 节点的原始文本输出（注意：节点输出结构为 \`{ _raw: '原始文本', ... }\`，条件表达式应使用 \`_raw\` 字段）
- \`outputs.nodeId._raw.includes('xxx')\` - 检查输出是否包含关键字（自动转为函数调用）
- \`startsWith(str, prefix)\` - 检查字符串开头
- \`lower(str)\` / \`upper(str)\` - 大小写转换
- \`variables.xxx\` - 访问变量
- \`len(array)\` - 数组长度
- \`has(obj, key)\` - 检查对象是否有某属性
- \`&&\` / \`||\` - 逻辑运算
- 数学运算: +, -, *, /

## 规则
1. 每个节点必须有唯一的 id
2. edges 定义节点之间的连接关系
3. 条件边使用 condition 属性，循环边使用 maxLoops 属性
4. review 节点的 prompt 必须要求输出以 APPROVED 或 REJECTED 开头，以便条件边判断
5. 只输出 JSON，不要有其他文字

## 常见失败模式（请规避）

1. **节点过细导致协调开销大**
   - 反例：5 个节点完成 Git 提交（check → review → stage → commit → verify）
   - 正例：2 个节点（analyze-changes → commit-and-verify）

2. **缺少错误处理节点**
   - 复杂任务应在关键步骤后添加验证节点
   - 如代码修改后添加 typecheck 验证

3. **迭代任务重复创建相似节点**
   - 反例：iteration-1, changelog-1, iteration-2, changelog-2...
   - 正例：每个 iteration 节点内完成迭代 + 文档更新

4. **忽略并行执行机会**
   - 独立的验证任务（如不同模块的测试）可以并行执行
   - 使用 edges 定义多个从同一节点出发的边实现并行

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

为了更全面地设计这个工作流，请创建一个 agent team 来协作完成规划：

**团队成员：**
1. **Requirements Analyst** - 负责深入分析任务需求、项目上下文和潜在风险
2. **Workflow Architect** - 负责设计节点划分、依赖关系和执行顺序
3. **QA Reviewer** - 负责审查方案的完整性、可靠性和最佳实践

**协作流程：**
1. Requirements Analyst 先分析任务，识别关键要素和潜在问题
2. Workflow Architect 基于分析结果设计工作流结构
3. QA Reviewer 审查设计，提出优化建议
4. 团队成员相互讨论，完善方案后输出最终 JSON workflow

**团队协作优势：**
- 从多个视角分析问题，发现盲区
- 通过辩论验证设计合理性
- 确保工作流既全面又优雅

请创建这个 agent team 并开始协作设计工作流。
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
