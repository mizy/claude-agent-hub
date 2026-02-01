# Claude Agent Hub 架构文档

## 概览

Claude Agent Hub 是一个基于 Claude Code CLI 的任务执行系统。通过 Workflow 引擎自动分析、拆解和执行开发任务，支持复杂的控制流（条件、循环、并行、定时、人工审批等）。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                CLI Layer                                     │
│                         src/cli/index.ts (@entry)                           │
│                                                                              │
│   cah "任务"    cah task list    cah workflow run    cah daemon start       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Agent Layer                                     │
│                                                                              │
│  ┌──────────────────┐  ┌───────────────────┐  ┌────────────────────────┐   │
│  │  runAgentForTask │  │  generateWorkflow │  │  executeWorkflowNode   │   │
│  │  任务执行入口     │  │  生成 JSON 执行计划 │  │  执行单个节点          │   │
│  └──────────────────┘  └───────────────────┘  └────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Workflow Engine                                   │
│                                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ WorkflowStore │  │ StateManager  │  │  NodeWorker  │  │WorkflowQueue │  │
│  │ 存储 workflow  │  │ 状态流转管理   │  │ 节点执行器    │  │ 任务队列     │  │
│  └───────────────┘  └───────────────┘  └──────────────┘  └──────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        executeNewNodes.ts                              │  │
│  │  delay | schedule | loop | foreach | switch | assign | script         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Claude Layer                                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  invokeClaudeCode({ prompt, mode, stream, onChunk })               │    │
│  │                                                                     │    │
│  │  $ claude --print --dangerously-skip-permissions "<prompt>"        │    │
│  │                                                                     │    │
│  │  Returns: Result<InvokeResult, InvokeError>                        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Storage Layer                                    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  TaskStore (文件系统, 默认 .cah-data/, 可通过 CAH_DATA_DIR 配置)       │   │
│  │  .cah-data/tasks/task-{id}/                                          │   │
│  │    ├── task.json          # 任务信息                                  │   │
│  │    ├── workflow.json      # 执行计划                                  │   │
│  │    ├── instance.json      # 运行状态                                  │   │
│  │    ├── conversations.json # AI 对话记录                               │   │
│  │    └── outputs/result.md  # 执行报告                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
src/
├── cli/                        # CLI 命令入口
│   ├── index.ts               # @entry 主入口
│   ├── output.ts              # 统一输出格式
│   ├── spinner.ts             # loading 状态
│   └── commands/              # 子命令
│       ├── task.ts
│       ├── workflow.ts
│       ├── agent.ts
│       └── daemon.ts
│
├── agent/                      # Agent 核心逻辑
│   ├── runAgentForTask.ts     # 任务执行入口
│   ├── generateWorkflow.ts    # 生成 Workflow
│   ├── executeWorkflowNode.ts # 执行节点
│   └── persona/               # Agent 人格配置
│
├── workflow/                   # Workflow 引擎
│   ├── types.ts               # 类型定义
│   ├── engine/
│   │   ├── StateManager.ts    # 状态管理
│   │   ├── WorkflowEngine.ts  # 引擎核心
│   │   ├── ConditionEvaluator.ts
│   │   └── executeNewNodes.ts # 新节点执行器
│   ├── queue/
│   │   ├── NodeWorker.ts      # 节点执行器
│   │   └── WorkflowQueue.ts   # 任务队列
│   ├── parser/
│   │   ├── parseJson.ts       # JSON 解析
│   │   └── parseMarkdown.ts   # Markdown 解析
│   └── store/
│       └── WorkflowStore.ts   # Workflow 存储
│
├── claude/                     # Claude Code 集成
│   └── invokeClaudeCode.ts    # Claude CLI 调用
│
├── task/                       # 任务管理
│   ├── createTaskWithFolder.ts
│   ├── listTasks.ts
│   ├── getTaskDetail.ts
│   └── resumeTask.ts
│
├── store/                      # 数据存储
│   ├── TaskStore.ts           # 任务文件存储
│   └── fileStore.ts           # Agent 存储
│
├── notify/                     # 通知系统
│   ├── lark.ts                # 飞书通知
│   └── larkServer.ts          # 审批回调服务
│
├── shared/                     # 公共基础设施
│   ├── result.ts              # Result<T, E> 类型
│   ├── logger.ts              # 日志系统
│   ├── error.ts               # 错误类型
│   └── time.ts                # 时间处理
│
├── scheduler/                  # 调度器
│   ├── startDaemon.ts         # 守护进程
│   ├── worker.ts              # Worker 抽象
│   └── queue.ts               # 优先级队列
│
└── prompts/                    # Prompt 模板
    └── taskPrompts.ts         # 任务相关 prompts
```

## 核心流程

### 任务执行流程

```
cah "修复登录 bug"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  createTaskWithFolder()                                          │
│  创建: .cah-data/tasks/task-20260131-143022-abc/task.json       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  runAgentForTask(agent, task)                                    │
│  1. 更新状态: pending → planning                                  │
│  2. 调用 generateWorkflow()                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  generateWorkflow(context)                                       │
│                                                                  │
│  buildJsonWorkflowPrompt() → invokeClaudeCode({ mode: 'plan' }) │
│                                                                  │
│  返回 Workflow {                                                 │
│    nodes: [start, task1, task2, ..., end],                      │
│    edges: [{from, to, condition?}, ...]                         │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  执行 Workflow                                                   │
│  1. 更新状态: planning → developing                              │
│  2. 启动 NodeWorker                                              │
│  3. startWorkflow() 创建 WorkflowInstance                        │
│  4. 循环执行节点直到完成                                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  executeNode(nodeJobData)                                        │
│                                                                  │
│  switch(node.type) {                                            │
│    case 'task':                                                  │
│      invokeClaudeCode({ prompt, mode: 'execute' })              │
│    case 'delay':                                                 │
│      executeDelayNode() → 等待指定时间                            │
│    case 'human':                                                 │
│      sendLarkNotification() → 等待审批                           │
│    ...                                                           │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  saveWorkflowOutputToTask()                                      │
│  1. 生成 Markdown 报告                                           │
│  2. 更新状态: developing → completed/failed                      │
│  3. 移动任务文件夹到对应状态目录                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 核心数据结构

### Task

```typescript
interface Task {
  id: string              // task-YYYYMMDD-HHMMSS-xxx
  title: string           // 任务标题
  description: string     // 完整描述
  priority: 'high' | 'medium' | 'low'
  status: TaskStatus      // pending → planning → developing → completed/failed
  assignee?: string       // Agent 名称
  workflowId?: string     // 关联的 Workflow ID
  pid?: number            // 执行进程 PID
  output?: {              // 执行结果
    workflowId: string
    instanceId: string
    finalStatus: string
    timing: { startedAt, completedAt }
  }
  createdAt: string
}
```

### Workflow

```typescript
interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: Record<string, unknown>
  inputs?: InputDefinition[]
  outputs?: Record<string, string>
  settings?: WorkflowSettings
}

interface WorkflowNode {
  id: string
  type: NodeType           // start | end | task | condition | parallel | join |
                           // human | delay | schedule | loop | foreach | switch |
                           // assign | script
  name: string
  task?: TaskConfig        // type=task 时的配置
  delay?: DelayConfig      // type=delay 时的配置
  loop?: LoopConfig        // type=loop 时的配置
  // ...其他节点配置
  timeout?: number
  onError?: 'fail' | 'skip' | 'continue'
  retry?: RetryConfig
}

interface WorkflowEdge {
  id: string
  from: string
  to: string
  condition?: string       // 条件表达式
  maxLoops?: number        // 循环边的最大次数
}
```

### WorkflowInstance

```typescript
interface WorkflowInstance {
  id: string
  workflowId: string
  status: WorkflowStatus   // pending | running | paused | completed | failed | cancelled
  nodeStates: Record<string, NodeState>
  variables: Record<string, unknown>
  outputs: Record<string, unknown>
  loopCounts: Record<string, number>
  startedAt?: string
  completedAt?: string
  error?: string
}

interface NodeState {
  status: NodeStatus       // pending | ready | running | waiting | done | failed | skipped
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
  attempts: number
}
```

## 节点类型详解

### 控制流节点

| 节点 | 配置 | 说明 |
|------|------|------|
| `start` | - | 流程入口，无配置 |
| `end` | - | 流程出口，无配置 |
| `condition` | `expression: string` | 条件分支，通过边的 condition 决定走向 |
| `parallel` | - | 并行网关，后续边同时执行 |
| `join` | - | 汇合网关，等待所有入边完成 |

### 任务节点

```typescript
interface TaskConfig {
  agent: string       // Agent 名称或 "auto"
  prompt: string      // 任务描述
  timeout?: number    // 超时（毫秒）
  retries?: number    // 重试次数
}
```

### 人工节点

```typescript
interface HumanConfig {
  assignee?: string     // 审批人
  timeout?: number      // 超时
  autoApprove?: boolean // 超时后自动通过
}
```

当执行到 human 节点时，会发送飞书通知，等待人工审批。

### 时间控制节点

```typescript
// 延迟节点 - 等待固定时间
interface DelayConfig {
  value: number
  unit: 's' | 'm' | 'h' | 'd'
}

// 定时节点 - 等待到指定时间
interface ScheduleConfig {
  cron?: string        // cron 表达式
  datetime?: string    // ISO 时间
  timezone?: string
}
```

### 循环节点

```typescript
interface LoopConfig {
  type: 'while' | 'for' | 'until'
  condition?: string     // while/until 条件
  init?: number          // for 初始值
  end?: number           // for 结束值
  step?: number          // for 步长
  loopVar?: string       // 循环变量名
  bodyNodes: string[]    // 循环体节点
  maxIterations?: number // 安全限制
}

interface ForeachConfig {
  collection: string     // 集合表达式
  itemVar?: string       // 项变量名
  indexVar?: string      // 索引变量名
  bodyNodes: string[]    // 循环体节点
  mode?: 'sequential' | 'parallel'
}
```

### 数据处理节点

```typescript
// 赋值节点
interface AssignConfig {
  assignments: Array<{
    variable: string
    value: unknown
    isExpression?: boolean
  }>
}

// 脚本节点
interface ScriptConfig {
  expression: string
  outputVar?: string
}

// 分支节点
interface SwitchConfig {
  expression: string
  cases: Array<{
    value: unknown | 'default'
    targetNode: string
  }>
}
```

## 表达式求值

使用 `expr-eval` 库，支持以下功能：

### 内置函数

```javascript
now()                    // Date.now()
floor(x), ceil(x), round(x)
min(a, b), max(a, b), abs(x)
len(arr)                 // 数组长度
has(obj, key)            // 检查属性
get(obj, key, default)   // 获取属性
str(x), num(x), bool(x)  // 类型转换
```

### 上下文变量

```javascript
variables.xxx            // Workflow 变量
outputs.nodeId.result    // 节点输出
loopCount                // 循环次数
index, item, total       // foreach 上下文
inputs.xxx               // 输入参数
```

### 自动转换

```javascript
Date.now()      → now()
Math.floor(x)   → floor(x)
&&              → and
||              → or
!               → not
```

## Claude Code 调用

### invokeClaudeCode

```typescript
interface InvokeOptions {
  prompt: string
  mode?: 'plan' | 'execute' | 'review'
  persona?: PersonaConfig
  cwd?: string
  stream?: boolean           // 实时输出
  onChunk?: (chunk: string) => void
  skipPermissions?: boolean  // 默认 true
  timeoutMs?: number         // 默认 30 分钟
}

// 返回 Result 类型
type Result =
  | { ok: true; value: InvokeResult }
  | { ok: false; error: InvokeError }

type InvokeError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }
```

### 使用示例

```typescript
const result = await invokeClaudeCode({
  prompt: '分析这个任务...',
  mode: 'plan',
  stream: true,  // 实时输出
})

if (!result.ok) {
  console.error(result.error.message)
  return
}

console.log(result.value.response)
```

## 状态流转

### Task 状态机

```
pending ──────► planning ──────► developing ──────► completed
    │              │                 │
    │              │                 ▼
    │              └────────────► failed
    │
    └──────────────────────────► cancelled
```

### Workflow Instance 状态机

```
pending ──► running ──► completed
               │
               ├──► paused ──► running
               │
               ├──► failed
               │
               └──► cancelled
```

### Node 状态机

```
pending ──► ready ──► running ──► done
                         │
                         ├──► waiting (human 节点)
                         │
                         ├──► failed
                         │
                         └──► skipped
```

## 扩展点

- [x] Workflow 引擎
- [x] 多种节点类型
- [x] 飞书通知
- [ ] 多 Agent 并行
- [ ] Web UI 监控
- [ ] 更多通知渠道
- [ ] Workflow 模板库
