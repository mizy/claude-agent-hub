# Claude Agent Hub 架构文档

## 概览

Claude Agent Hub 是一个自举式 AI 任务执行系统。通过 Workflow 引擎自动分析、拆解和执行开发任务，支持多种 CLI 后端（claude-code/opencode/iflow/codebuddy）和复杂的控制流（条件、循环、并行、定时、人工审批等）。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                CLI Layer                                     │
│                         src/cli/index.ts (@entry)                           │
│                                                                              │
│   cah "任务"    cah task list    cah report trend    cah daemon start       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Task Execution Layer                                 │
│                                                                              │
│  ┌──────────────┐  ┌───────────────────┐  ┌─────────────────────────────┐  │
│  │  createTask  │  │  executeTask      │  │  resumeTask                 │  │
│  │  任务创建     │  │  任务执行(前台/后台) │  │  恢复中断任务              │  │
│  └──────────────┘  └───────────────────┘  └─────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Analysis: 项目上下文分析、历史学习、任务分类、时间预估                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
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
│  │  generateWorkflow: AI 生成工作流                                        │  │
│  │  executeNode: 执行节点(使用 Persona)                                    │  │
│  │  控制流: delay | schedule | loop | foreach | switch | assign | script  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Backend Layer                                    │
│                        CLI 后端抽象层 (@entry)                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  Adapters:                                                          │    │
│  │  - ClaudeCodeAdapter (claude-code CLI)                             │    │
│  │  - OpenCodeAdapter (opencode CLI)                                  │    │
│  │  - IflowAdapter (iflow CLI)                                        │    │
│  │  - CodebuddyAdapter (codebuddy CLI)                                │    │
│  │                                                                     │    │
│  │  createBackend(type) → IBackend                                    │    │
│  │  backend.execute({ prompt, persona, cwd, onChunk })                │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Storage & Report Layer                              │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Store: TaskStore, WorkflowStore, UnifiedStore                       │   │
│  │  Report: 趋势分析、实时监控、执行对比、退化检测                         │   │
│  │  Notify: 飞书 WSClient + Telegram 长轮询(双向对话终端)                │   │
│  │                                                                      │   │
│  │  .cah-data/tasks/task-{id}/                                         │   │
│  │    ├── task.json          # 任务元数据                               │   │
│  │    ├── workflow.json      # 工作流定义                               │   │
│  │    ├── instance.json      # 唯一执行状态源                            │   │
│  │    ├── stats.json         # 聚合统计(从 instance 派生)                │   │
│  │    ├── timeline.json      # 事件时间线                               │   │
│  │    ├── process.json       # 后台进程信息                             │   │
│  │    ├── logs/              # execution.log + events.jsonl            │   │
│  │    └── outputs/result.md  # 执行报告                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
src/
├── cli/                        # CLI 命令入口
│   ├── index.ts               # @entry 主入口
│   ├── output.ts              # 统一输出格式(ui 工具)
│   ├── spinner.ts             # loading 状态
│   └── commands/              # 子命令
│       ├── task.ts
│       ├── report.ts
│       └── daemon.ts
│
├── backend/                    # CLI 后端抽象层
│   ├── index.ts               # @entry 后端工厂
│   ├── IBackend.ts            # 后端接口
│   └── adapters/              # 各 CLI 适配器
│       ├── ClaudeCodeAdapter.ts
│       ├── OpenCodeAdapter.ts
│       ├── IflowAdapter.ts
│       └── CodebuddyAdapter.ts
│
├── task/                       # Task 层：生命周期 + 执行
│   ├── createTask.ts
│   ├── executeTask.ts         # 任务执行(进度条/ETA/统计)
│   ├── resumeTask.ts
│   ├── queryTask.ts           # 查询(list/get/poll)
│   ├── taskLifecycle.ts       # 生命周期管理
│   ├── ExecutionProgress.ts
│   └── ExecutionStats.ts
│
├── workflow/                   # Workflow 层：定义、状态、生成
│   ├── index.ts               # @entry
│   ├── types.ts               # 类型定义
│   ├── generateWorkflow.ts    # AI 生成工作流
│   ├── executeNode.ts         # 执行单个节点(使用 Persona)
│   ├── engine/
│   │   ├── StateManager.ts    # 状态管理
│   │   ├── WorkflowEngine.ts  # 引擎核心
│   │   ├── ConditionEvaluator.ts
│   │   └── executeNewNodes.ts # 控制流节点执行器
│   ├── queue/
│   │   ├── NodeWorker.ts      # 节点执行器
│   │   └── WorkflowQueue.ts   # 任务队列
│   └── parser/
│       ├── parseJson.ts       # JSON 解析
│       └── parseMarkdown.ts   # Markdown 解析
│
├── persona/                    # Persona 层：执行角色定义
│   ├── builtinPersonas.ts     # 内置人格(Architect/Pragmatist 等)
│   ├── loadPersona.ts         # 加载人格配置
│   └── personaMcpConfig.ts    # MCP 配置
│
├── analysis/                   # Analysis 层：项目分析、学习、预估
│   ├── projectContext.ts      # 项目上下文分析
│   ├── executionHistory.ts    # 历史学习
│   ├── TaskClassifier.ts      # 任务分类
│   ├── PatternRecognizer.ts   # 模式识别
│   └── timeEstimator.ts       # 时间预估
│
├── report/                     # 报告分析
│   ├── trendReport.ts         # 趋势分析
│   ├── liveReport.ts          # 实时监控
│   └── compareExecutions.ts   # 执行对比(退化检测)
│
├── store/                      # 数据存储
│   ├── index.ts               # @entry
│   ├── GenericFileStore.ts    # 通用文件存储
│   ├── TaskStore.ts           # 任务存储
│   ├── WorkflowStore.ts       # Workflow 存储
│   ├── UnifiedStore.ts        # 统一存储
│   ├── paths.ts               # 路径常量
│   ├── readWriteJson.ts       # JSON 工具
│   └── types.ts               # 类型定义
│
├── notify/                     # 通知系统
│   ├── index.ts               # @entry
│   ├── buildLarkCard.ts       # 飞书卡片构建器(纯函数)
│   ├── larkServer.ts          # 飞书服务器
│   ├── larkWsClient.ts        # 飞书 WebSocket 客户端(事件+卡片回调)
│   ├── sendLarkNotify.ts      # 发送飞书通知(卡片+文本)
│   ├── telegramClient.ts      # Telegram 客户端
│   ├── telegramChatHandler.ts # Telegram 对话处理
│   ├── telegramCommandHandler.ts # Telegram 命令处理
│   └── sendTelegramNotify.ts  # 发送 Telegram 通知
│
├── scheduler/                  # 调度器
│   ├── startDaemon.ts         # 守护进程
│   ├── eventBus.ts            # 事件总线
│   ├── worker.ts              # Worker 抽象
│   └── queue.ts               # 优先级队列
│
├── server/                     # Web 服务器
│   └── express.ts             # Express 服务器(workflow 可视化)
│
├── shared/                     # 公共基础设施
│   ├── result.ts              # Result<T, E> 类型
│   ├── logger.ts              # 日志系统
│   ├── error.ts               # AppError 错误类型
│   ├── time.ts                # 时间处理
│   └── id.ts                  # ID 生成
│
├── config/                     # 配置系统
│   ├── index.ts               # @entry
│   ├── schema.ts              # 配置 Schema
│   └── loadConfig.ts          # 配置加载
│
├── prompts/                    # Prompt 模板
│   └── workflowPrompts.ts     # Workflow 生成 prompts
│
└── types/                      # 全局类型定义
    └── ...
```

## 核心流程

### 任务执行流程

```
cah "修复登录 bug"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  createTask()                                                    │
│  1. 生成 taskId: task-YYYYMMDD-HHMMSS-xxx                        │
│  2. 创建目录: .cah-data/tasks/task-{id}/                         │
│  3. 写入 task.json                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  executeTask(task, options)                                      │
│  1. 分析项目上下文(Analysis)                                      │
│  2. 学习历史执行(ExecutionHistory)                                │
│  3. 更新状态: pending → planning                                  │
│  4. 调用 generateWorkflow()                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  generateWorkflow(task, context)                                 │
│                                                                  │
│  buildWorkflowPrompt() → backend.execute({                       │
│    prompt: "分析任务并生成 workflow...",                          │
│    persona: 'architect'                                          │
│  })                                                              │
│                                                                  │
│  返回 Workflow {                                                 │
│    nodes: [start, task1, task2, ..., end],                      │
│    edges: [{from, to, condition?}, ...],                        │
│    variables: {}                                                │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  执行 Workflow                                                   │
│  1. 保存 workflow.json                                           │
│  2. 更新状态: planning → developing                              │
│  3. 创建 WorkflowInstance(instance.json)                         │
│  4. 启动 NodeWorker 循环执行节点                                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  executeNode(node, instance)                                     │
│                                                                  │
│  switch(node.type) {                                            │
│    case 'task':                                                  │
│      backend.execute({                                          │
│        prompt: node.task.prompt,                                │
│        persona: node.task.persona,                              │
│        cwd: task.cwd,                                           │
│        onChunk: (chunk) => updateProgress(chunk)                │
│      })                                                          │
│    case 'delay':                                                 │
│      setTimeout(() => resolve(), delay)                         │
│    case 'human':                                                 │
│      sendNotification() → 等待审批                               │
│    case 'loop', 'foreach', 'condition':                         │
│      executeControlFlowNode()                                   │
│    ...                                                           │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  完成任务                                                         │
│  1. 更新 instance.json(最终状态)                                  │
│  2. 生成 stats.json(从 instance 派生)                             │
│  3. 生成 outputs/result.md                                       │
│  4. 更新状态: developing → completed/failed                      │
│  5. 发送通知(飞书/Telegram)                                       │
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
  persona?: string        // Persona 名称(如 'architect', 'pragmatist')
  workflowId?: string     // 关联的 Workflow ID
  backend?: string        // 使用的后端(claude-code/opencode/iflow/codebuddy)
  pid?: number            // 执行进程 PID
  output?: {              // 执行结果
    workflowId: string
    instanceId: string
    finalStatus: string
    timing: { startedAt, completedAt }
  }
  createdAt: string
  updatedAt?: string
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

## Backend 抽象层

支持多种 CLI 后端,通过统一接口调用:

### IBackend 接口

```typescript
interface IBackend {
  type: BackendType  // 'claude-code' | 'opencode' | 'iflow' | 'codebuddy'

  execute(options: ExecuteOptions): Promise<Result<ExecuteResult, ExecuteError>>

  isAvailable(): Promise<boolean>  // 检查 CLI 是否安装
}

interface ExecuteOptions {
  prompt: string
  persona?: PersonaConfig         // Persona 配置
  cwd?: string                    // 工作目录
  stream?: boolean                // 是否流式输出
  onChunk?: (chunk: string) => void  // 流式回调
  timeoutMs?: number              // 超时时间
}

interface ExecuteResult {
  response: string                // CLI 输出
  exitCode: number                // 退出码
  duration: number                // 执行时长(ms)
}

type ExecuteError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }
  | { type: 'not_available'; message: string }
```

### 使用示例

```typescript
import { createBackend } from './backend'

const backend = createBackend('claude-code')

const result = await backend.execute({
  prompt: '分析这个任务并生成 workflow...',
  persona: { name: 'architect' },
  stream: true,
  onChunk: (chunk) => console.log(chunk),
})

if (!result.ok) {
  console.error(result.error.message)
  return
}

console.log(result.value.response)
```

### Adapter 实现

每个 Adapter 负责将统一接口转换为对应 CLI 的命令:

- **ClaudeCodeAdapter**: `claude --print --dangerously-skip-permissions "<prompt>"`
- **OpenCodeAdapter**: `opencode --print "<prompt>"`
- **IflowAdapter**: `iflow execute --prompt "<prompt>"`
- **CodebuddyAdapter**: `codebuddy run "<prompt>"`

## 通知系统

支持飞书和 Telegram 两种通知渠道,提供双向对话终端能力。

### 飞书通知

基于 WebSocket 的实时通知和交互:

- **LarkWsClient**: WebSocket 客户端,接收飞书事件(消息、卡片按钮回调、入群等)
- **buildLarkCard**: 卡片构建器,纯函数生成 Interactive Card JSON
- **sendLarkNotify**: 发送卡片/文本消息(API 优先,webhook 降级)

功能:
- 交互式卡片消息(审批按钮、任务列表、任务详情、帮助指令)
- 卡片按钮回调(`card.action.trigger` — 点击审批按钮直接通过/拒绝)
- 任务完成/失败卡片通知(绿色/红色 header)
- 首次对话欢迎卡片(`p2p_chat_create` 事件)
- 人工审批节点交互(按钮 + 文字双通道)
- 实时对话终端(通过飞书消息控制任务)

卡片类型:
| 卡片 | 触发时机 | Header 颜色 |
|------|---------|------------|
| 审批请求 | human 节点等待审批 | 橙色 |
| 审批结果 | 审批通过/拒绝 | 绿色/红色 |
| 任务完成 | 任务执行成功 | 绿色 |
| 任务失败 | 任务执行失败 | 红色 |
| 任务列表 | `/list` 指令 | 蓝色 |
| 任务详情 | `/get` 指令 | 蓝色 |
| 待审批状态 | `/status` 指令 | 橙色 |
| 帮助指令 | `/help` 指令 | 蓝色 |
| 欢迎卡片 | 首次与 bot 对话 | 蓝色 |

### Telegram 通知

基于长轮询的通知和对话:

- **TelegramClient**: 长轮询客户端,接收 Telegram 消息
- **TelegramChatHandler**: 对话处理器,管理会话状态
- **TelegramCommandHandler**: 命令处理器,支持 `/list`, `/status`, `/logs` 等
- **sendTelegramNotify**: 发送 Telegram 消息

功能:
- 任务状态变更通知
- 对话式任务管理(通过 Telegram 聊天创建和管理任务)
- 命令交互(`/list`, `/status <id>`, `/logs <id>`, `/cancel <id>`)
- 实时日志查看

### 配置

```yaml
notify:
  lark:
    enabled: true
    appId: "cli_xxx"
    appSecret: "xxx"
    chatId: "oc_xxx"       # 可选,默认推送通知目标(运行时也会自动记录)
    webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"

  telegram:
    enabled: true
    botToken: "123456:ABC-DEF..."
    chatId: "123456789"  # 可选,默认通知目标
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

## 已实现功能

- [x] Workflow 引擎(条件、循环、并行、定时等)
- [x] 多种节点类型(task/delay/schedule/loop/foreach/condition/parallel/join/human/assign/script/switch)
- [x] 多 Backend 支持(claude-code/opencode/iflow/codebuddy)
- [x] Persona 系统(Architect/Pragmatist/Explorer 等)
- [x] 飞书通知(WebSocket + 双向对话 + 交互式卡片 + 按钮回调)
- [x] Telegram 通知(长轮询 + 对话终端)
- [x] 项目上下文分析
- [x] 历史执行学习
- [x] 时间预估(ETA)
- [x] 任务报告(趋势分析/实时监控/执行对比)
- [x] Web 服务器(workflow 可视化)
- [x] 后台守护进程
- [x] 事件总线

## 扩展方向

- [ ] Workflow 模板库
- [ ] 更多 Backend 适配器
- [ ] 更多 Persona 定义
- [ ] 分布式执行
- [ ] 任务依赖图
- [ ] 更丰富的报告和可视化
