# Workflow 工作流系统设计文档

## 1. 需求概述

### 1.1 背景
当前 `cah task add` 只能创建单一任务。实际开发场景中，一个需求往往需要拆解为多个子任务，由不同 Agent 协作完成，且存在依赖、并行、条件分支、甚至循环（如代码审核不通过需要重新修改）。

### 1.2 目标
设计一个轻量级工作流引擎，支持：
- 从 Markdown 需求文档自动生成工作流
- 有向有环图（支持循环，如审核驳回）
- 条件分支（满足条件才执行下游）
- 并行执行（无依赖节点同时运行）
- 子 Agent 任务分发

### 1.3 使用场景

```bash
# 场景1: 从 markdown 创建工作流
cah task add --file ./requirements/login-feature.md

# 场景2: 命令行直接输入
cah task add --title "实现用户登录" --description "..."

# 场景3: 查看工作流状态
cah workflow status <workflow-id>

# 场景4: 手动干预（审批/驳回某节点）
cah workflow approve <workflow-id> <node-id>
cah workflow reject <workflow-id> <node-id> --reason "..."
```

---

## 2. 技术选型

### 2.1 核心框架：BullMQ

选择 **BullMQ** 作为任务队列基础，在其上封装 Workflow 引擎。

**选择理由：**
- 成熟稳定，生产级别
- 基于 Redis，天然支持分布式
- 内置重试、延迟、优先级
- TypeScript 原生支持
- 活跃社区，长期维护

**BullMQ 不直接支持的特性（需封装）：**
- 有环图（循环）
- 条件分支
- 工作流状态管理

### 2.2 存储方案

| 数据 | 存储 | 说明 |
|------|------|------|
| 任务队列 | Redis (BullMQ) | Job 执行、重试、延迟 |
| 工作流定义 | SQLite | workflow.json 持久化 |
| 运行时状态 | SQLite | 节点状态、变量、历史 |
| 节点输出 | 文件系统 | JSON 文件，便于查看 |

### 2.3 依赖库

```json
{
  "bullmq": "^5.x",      // 任务队列
  "ioredis": "^5.x",     // Redis 客户端
  "expr-eval": "^2.x",   // 条件表达式求值
  "marked": "^12.x"      // Markdown 解析
}
```

---

## 3. 架构设计

### 3.1 模块结构

```
src/workflow/
├── index.ts                 # 统一导出
├── types.ts                 # 类型定义
│
├── engine/                  # 工作流引擎
│   ├── WorkflowEngine.ts    # @entry 引擎核心
│   ├── NodeExecutor.ts      # 节点执行器
│   ├── ConditionEvaluator.ts # 条件求值
│   └── StateManager.ts      # 状态管理
│
├── parser/                  # 解析器
│   ├── parseMarkdown.ts     # MD → Workflow
│   ├── parseJson.ts         # JSON → Workflow
│   └── validateWorkflow.ts  # 图结构校验
│
├── queue/                   # BullMQ 封装
│   ├── WorkflowQueue.ts     # 工作流队列
│   ├── NodeWorker.ts        # 节点 Worker
│   └── connection.ts        # Redis 连接
│
└── store/                   # 存储
    ├── WorkflowStore.ts     # 工作流 CRUD
    └── migrations/          # 数据库迁移
```

### 3.2 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Layer                                 │
│  cah task add --file    cah workflow status    cah workflow approve │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                      Workflow Engine                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Parser    │  │  Executor   │  │   State     │              │
│  │  MD/JSON →  │  │  调度节点   │  │  Manager    │              │
│  │  Workflow   │  │  触发下游   │  │  状态追踪   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                       BullMQ Layer                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  workflow:nodes Queue                                    │    │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                        │    │
│  │  │Job 1│ │Job 2│ │Job 3│ │ ... │                        │    │
│  │  └─────┘ └─────┘ └─────┘ └─────┘                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌───────────────────────────▼─────────────────────────────┐    │
│  │  NodeWorker (处理节点任务)                               │    │
│  │  - 调用 Agent 执行                                       │    │
│  │  - 更新状态                                              │    │
│  │  - 触发下游节点                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                      Storage Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Redis     │  │   SQLite    │  │ File System │              │
│  │  Job Queue  │  │  Workflow   │  │   Outputs   │              │
│  │             │  │  Instance   │  │   Logs      │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 执行流程

```
1. 创建工作流
   ├─ 解析输入 (MD/JSON/CLI)
   ├─ 校验图结构
   ├─ 保存到 SQLite
   └─ 返回 workflow-id

2. 启动执行
   ├─ 加载 workflow 定义
   ├─ 创建 instance 记录
   ├─ 找到入口节点 (start)
   └─ 入队第一批节点

3. 节点执行 (NodeWorker)
   ├─ 从队列取出 Job
   ├─ 检查前置条件
   │   ├─ 所有上游完成？
   │   └─ 条件表达式满足？
   ├─ 执行节点
   │   ├─ task: 调用 Agent
   │   ├─ human: 等待审批
   │   ├─ condition: 求值分支
   │   └─ parallel/join: 控制流
   ├─ 保存输出
   ├─ 更新状态
   └─ 触发下游节点入队

4. 循环处理
   ├─ 检查 maxLoops
   ├─ 重置目标节点状态
   └─ 重新入队
```

---

## 4. 数据模型

### 4.1 Workflow 定义

```typescript
// src/workflow/types.ts

export type NodeType = 'start' | 'end' | 'task' | 'condition' | 'parallel' | 'join' | 'human'
export type NodeStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped'
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface Workflow {
  id: string
  name: string
  description: string

  nodes: WorkflowNode[]
  edges: WorkflowEdge[]

  variables: Record<string, unknown>

  createdAt: string
  sourceFile?: string
}

export interface WorkflowNode {
  id: string
  type: NodeType
  name: string

  // task 节点配置
  task?: {
    agent: string        // Agent 名称或 "auto"
    prompt: string       // 任务描述
    timeout?: number     // 超时（毫秒）
    retries?: number     // 重试次数
  }

  // condition 节点配置
  condition?: {
    expression: string   // 条件表达式
  }

  // human 节点配置
  human?: {
    timeout?: number     // 审批超时
    autoApprove?: boolean
  }
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
  condition?: string     // 边上的条件
  maxLoops?: number      // 最大循环次数（用于有环图）
}
```

### 4.2 运行时状态

```typescript
export interface WorkflowInstance {
  id: string
  workflowId: string
  status: WorkflowStatus

  nodeStates: Record<string, NodeState>
  variables: Record<string, unknown>
  outputs: Record<string, unknown>

  loopCounts: Record<string, number>  // edge-id → 循环次数

  startedAt: string
  completedAt?: string
  error?: string
}

export interface NodeState {
  status: NodeStatus
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
  attempts: number
}
```

### 4.3 BullMQ Job 数据

```typescript
export interface NodeJobData {
  workflowId: string
  instanceId: string
  nodeId: string
  attempt: number
}

export interface NodeJobResult {
  success: boolean
  output?: unknown
  error?: string
  nextNodes?: string[]  // 触发的下游节点
}
```

---

## 5. 核心实现

### 5.1 Redis 连接

```typescript
// src/workflow/queue/connection.ts

import { Redis } from 'ioredis'

let connection: Redis | null = null

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,  // BullMQ 要求
    })
  }
  return connection
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit()
    connection = null
  }
}
```

### 5.2 工作流队列

```typescript
// src/workflow/queue/WorkflowQueue.ts

import { Queue } from 'bullmq'
import { getRedisConnection } from './connection.js'
import type { NodeJobData } from '../types.js'

export function createWorkflowQueue(): Queue<NodeJobData> {
  return new Queue('workflow:nodes', {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  })
}

// 入队节点任务
export async function enqueueNode(
  queue: Queue<NodeJobData>,
  data: NodeJobData,
  options?: { delay?: number; priority?: number }
): Promise<void> {
  await queue.add(`node:${data.nodeId}`, data, {
    delay: options?.delay,
    priority: options?.priority,
    jobId: `${data.instanceId}:${data.nodeId}:${data.attempt}`,
  })
}
```

### 5.3 节点 Worker

```typescript
// src/workflow/queue/NodeWorker.ts

import { Worker, Job } from 'bullmq'
import { getRedisConnection } from './connection.js'
import { executeNode } from '../engine/NodeExecutor.js'
import { getNextNodes } from '../engine/WorkflowEngine.js'
import { enqueueNode, createWorkflowQueue } from './WorkflowQueue.js'
import type { NodeJobData, NodeJobResult } from '../types.js'

export function createNodeWorker(): Worker<NodeJobData, NodeJobResult> {
  const queue = createWorkflowQueue()

  return new Worker<NodeJobData, NodeJobResult>(
    'workflow:nodes',
    async (job: Job<NodeJobData>): Promise<NodeJobResult> => {
      const { workflowId, instanceId, nodeId, attempt } = job.data

      try {
        // 执行节点
        const result = await executeNode(workflowId, instanceId, nodeId)

        if (!result.success) {
          return { success: false, error: result.error }
        }

        // 获取下游节点
        const nextNodes = await getNextNodes(workflowId, instanceId, nodeId)

        // 入队下游节点
        for (const nextNodeId of nextNodes) {
          await enqueueNode(queue, {
            workflowId,
            instanceId,
            nodeId: nextNodeId,
            attempt: 1,
          })
        }

        return {
          success: true,
          output: result.output,
          nextNodes,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,  // 并发处理
    }
  )
}
```

### 5.4 条件求值

```typescript
// src/workflow/engine/ConditionEvaluator.ts

import { Parser } from 'expr-eval'

const parser = new Parser()

export interface EvalContext {
  outputs: Record<string, unknown>
  variables: Record<string, unknown>
  loopCount: number
}

export function evaluateCondition(
  expression: string,
  context: EvalContext
): boolean {
  try {
    const expr = parser.parse(expression)
    const result = expr.evaluate({
      outputs: context.outputs,
      variables: context.variables,
      loopCount: context.loopCount,
    })
    return Boolean(result)
  } catch (error) {
    console.error(`Failed to evaluate: ${expression}`, error)
    return false
  }
}
```

### 5.5 循环处理

```typescript
// src/workflow/engine/WorkflowEngine.ts (部分)

export async function getNextNodes(
  workflowId: string,
  instanceId: string,
  currentNodeId: string
): Promise<string[]> {
  const workflow = await loadWorkflow(workflowId)
  const instance = await loadInstance(instanceId)

  const outEdges = workflow.edges.filter(e => e.from === currentNodeId)
  const nextNodes: string[] = []

  for (const edge of outEdges) {
    // 检查条件
    if (edge.condition) {
      const context: EvalContext = {
        outputs: instance.outputs,
        variables: instance.variables,
        loopCount: instance.loopCounts[edge.id] || 0,
      }

      if (!evaluateCondition(edge.condition, context)) {
        continue
      }
    }

    // 检查循环次数
    if (edge.maxLoops !== undefined) {
      const currentLoops = instance.loopCounts[edge.id] || 0
      if (currentLoops >= edge.maxLoops) {
        continue  // 超过最大循环次数，跳过
      }

      // 增加循环计数
      await incrementLoopCount(instanceId, edge.id)

      // 重置目标节点状态（允许重新执行）
      await resetNodeState(instanceId, edge.to)
    }

    nextNodes.push(edge.to)
  }

  return nextNodes
}
```

---

## 6. 状态管理

### 6.1 SQLite Schema

```sql
-- 工作流定义表
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition TEXT NOT NULL,  -- JSON
  source_file TEXT,
  created_at TEXT NOT NULL
);

-- 工作流实例表
CREATE TABLE workflow_instances (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  node_states TEXT NOT NULL DEFAULT '{}',  -- JSON
  variables TEXT NOT NULL DEFAULT '{}',    -- JSON
  outputs TEXT NOT NULL DEFAULT '{}',      -- JSON
  loop_counts TEXT NOT NULL DEFAULT '{}',  -- JSON
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

-- 索引
CREATE INDEX idx_instances_workflow ON workflow_instances(workflow_id);
CREATE INDEX idx_instances_status ON workflow_instances(status);
```

### 6.2 状态转换

```
Workflow Instance 状态机:

  pending ──start()──▶ running ──complete()──▶ completed
     │                    │
     │                    ├──pause()──▶ paused ──resume()──┐
     │                    │                                 │
     │                    ◀────────────────────────────────┘
     │                    │
     │                    └──fail()──▶ failed
     │
     └──cancel()──▶ cancelled


Node 状态机:

  pending ──ready()──▶ ready ──start()──▶ running
                                            │
                         ┌──────────────────┼──────────────────┐
                         ▼                  ▼                  ▼
                       done              failed             skipped
                                           │
                                           └──reset()──▶ pending (循环)
```

---

## 7. Markdown 解析

### 7.1 输入格式

```markdown
# 用户登录功能

## 背景
实现完整的用户认证系统...

## 任务

### 1. 设计数据库
- agent: architect
- 描述: 设计用户表结构

### 2. 实现后端API
- agent: backend
- 依赖: 设计数据库
- 描述: 实现登录接口

### 3. 实现前端
- agent: frontend
- 依赖: 设计数据库
- 描述: 实现登录页面

### 4. 代码审核
- 类型: human
- 依赖: 实现后端API, 实现前端

### 5. 部署
- agent: devops
- 依赖: 代码审核
- 条件: outputs.review.approved == true

## 循环
- 代码审核 → 实现后端API (当 outputs.review.approved == false, 最多3次)
```

### 7.2 解析器实现

```typescript
// src/workflow/parser/parseMarkdown.ts

import { marked } from 'marked'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../types.js'
import { generateId } from '../../shared/id.js'

export function parseMarkdown(content: string): Workflow {
  const tokens = marked.lexer(content)

  const workflow: Workflow = {
    id: generateId(),
    name: '',
    description: '',
    nodes: [
      { id: 'start', type: 'start', name: '开始' },
      { id: 'end', type: 'end', name: '结束' },
    ],
    edges: [],
    variables: {},
    createdAt: new Date().toISOString(),
  }

  let currentSection = ''
  let taskIndex = 0
  const taskNameToId: Record<string, string> = {}

  for (const token of tokens) {
    if (token.type === 'heading') {
      if (token.depth === 1) {
        workflow.name = token.text
      } else if (token.depth === 2) {
        currentSection = token.text.toLowerCase()
      } else if (token.depth === 3 && currentSection === '任务') {
        // 解析任务节点
        const taskName = token.text.replace(/^\d+\.\s*/, '')
        const nodeId = `task-${++taskIndex}`
        taskNameToId[taskName] = nodeId

        // ... 解析后续的列表项获取 agent、依赖等
      }
    }
  }

  // 添加 start → 第一个任务 的边
  // 添加 最后一个任务 → end 的边
  // 根据依赖关系添加边

  return workflow
}
```

---

## 8. CLI 命令

### 8.1 命令结构

```typescript
// src/cli/commands/workflow.ts

import { Command } from 'commander'

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow')
    .description('工作流管理')

  cmd
    .command('list')
    .description('列出所有工作流')
    .action(listWorkflows)

  cmd
    .command('status <id>')
    .description('查看工作流状态')
    .action(showWorkflowStatus)

  cmd
    .command('start <id>')
    .description('启动工作流')
    .action(startWorkflow)

  cmd
    .command('pause <id>')
    .description('暂停工作流')
    .action(pauseWorkflow)

  cmd
    .command('resume <id>')
    .description('恢复工作流')
    .action(resumeWorkflow)

  cmd
    .command('cancel <id>')
    .description('取消工作流')
    .action(cancelWorkflow)

  cmd
    .command('approve <workflow-id> <node-id>')
    .description('审批通过')
    .action(approveNode)

  cmd
    .command('reject <workflow-id> <node-id>')
    .option('-r, --reason <reason>', '驳回原因')
    .description('审批驳回')
    .action(rejectNode)

  return cmd
}
```

### 8.2 task add 扩展

```typescript
// src/cli/commands/task.ts (扩展)

cmd
  .command('add')
  .option('-t, --title <title>', '任务标题')
  .option('-d, --description <desc>', '任务描述')
  .option('-f, --file <path>', '从 Markdown 文件创建工作流')
  .action(async (options) => {
    if (options.file) {
      // 从文件创建工作流
      const content = await readFile(options.file, 'utf-8')
      const workflow = parseMarkdown(content)
      await saveWorkflow(workflow)
      await startWorkflow(workflow.id)
      console.log(`Created workflow: ${workflow.id}`)
    } else {
      // 创建单任务（包装为单节点工作流）
      const workflow = createSingleTaskWorkflow(options.title, options.description)
      await saveWorkflow(workflow)
      await startWorkflow(workflow.id)
      console.log(`Created task: ${workflow.id}`)
    }
  })
```

---

## 9. 文件存储结构

```
.claude-agent-hub/
├── data.db                      # SQLite 数据库
└── workflows/
    └── <workflow-id>/
        ├── source.md            # 原始 Markdown（如有）
        └── outputs/
            ├── task-1.json      # 节点输出
            ├── task-2.json
            └── ...
```

---

## 10. 实现计划

### Phase 1: 基础框架 ✅
- [x] 项目架构搭建
- [x] BullMQ 集成
- [x] 类型定义

### Phase 2: 核心引擎
- [ ] WorkflowStore (SQLite CRUD)
- [ ] WorkflowQueue (BullMQ 封装)
- [ ] NodeWorker (节点执行)
- [ ] StateManager (状态管理)

### Phase 3: 解析与验证
- [ ] Markdown 解析器
- [ ] JSON 解析器
- [ ] 图结构验证

### Phase 4: CLI 命令
- [ ] workflow list/status/start/pause/resume/cancel
- [ ] workflow approve/reject
- [ ] task add --file

### Phase 5: 高级特性
- [ ] 条件表达式求值
- [ ] 循环支持（有环图）
- [ ] 人工审批节点
- [ ] 并行/汇合网关

---

## 11. 完整示例

### 11.1 Markdown 输入

```markdown
# 用户登录功能

## 背景
为应用添加完整的用户认证系统，包括登录、注册、登出功能。

## 任务

### 1. 设计数据库Schema
- agent: architect
- 描述: 设计 users 表和 sessions 表结构

### 2. 实现后端API
- agent: backend
- 依赖: 设计数据库Schema
- 描述: 实现 /auth/login, /auth/register, /auth/logout 接口

### 3. 实现前端页面
- agent: frontend
- 依赖: 设计数据库Schema
- 描述: 实现登录和注册页面组件

### 4. 编写测试
- agent: tester
- 依赖: 实现后端API, 实现前端页面
- 描述: 编写单元测试和 E2E 测试

### 5. 代码审核
- 类型: human
- 依赖: 编写测试
- 描述: 人工审核代码质量

### 6. 部署上线
- agent: devops
- 依赖: 代码审核
- 条件: outputs.review.approved == true
- 描述: 部署到生产环境

## 循环
- 代码审核 → 实现后端API (当 outputs.review.approved == false, 最多3次)
```

### 11.2 生成的 Workflow JSON

```json
{
  "id": "wf-a1b2c3",
  "name": "用户登录功能",
  "description": "为应用添加完整的用户认证系统...",
  "nodes": [
    { "id": "start", "type": "start", "name": "开始" },
    { "id": "task-1", "type": "task", "name": "设计数据库Schema", "task": { "agent": "architect", "prompt": "设计 users 表和 sessions 表结构" } },
    { "id": "task-2", "type": "task", "name": "实现后端API", "task": { "agent": "backend", "prompt": "实现 /auth/login..." } },
    { "id": "task-3", "type": "task", "name": "实现前端页面", "task": { "agent": "frontend", "prompt": "实现登录和注册页面组件" } },
    { "id": "task-4", "type": "task", "name": "编写测试", "task": { "agent": "tester", "prompt": "编写单元测试和 E2E 测试" } },
    { "id": "task-5", "type": "human", "name": "代码审核", "human": { "timeout": 86400000 } },
    { "id": "task-6", "type": "task", "name": "部署上线", "task": { "agent": "devops", "prompt": "部署到生产环境" } },
    { "id": "end", "type": "end", "name": "结束" }
  ],
  "edges": [
    { "id": "e1", "from": "start", "to": "task-1" },
    { "id": "e2", "from": "task-1", "to": "task-2" },
    { "id": "e3", "from": "task-1", "to": "task-3" },
    { "id": "e4", "from": "task-2", "to": "task-4" },
    { "id": "e5", "from": "task-3", "to": "task-4" },
    { "id": "e6", "from": "task-4", "to": "task-5" },
    { "id": "e7", "from": "task-5", "to": "task-6", "condition": "outputs.review.approved == true" },
    { "id": "e8", "from": "task-5", "to": "task-2", "condition": "outputs.review.approved == false", "maxLoops": 3 },
    { "id": "e9", "from": "task-6", "to": "end" }
  ],
  "variables": {},
  "createdAt": "2024-01-15T10:00:00Z",
  "sourceFile": "./login-feature.md"
}
```

### 11.3 执行流程

```
1. cah task add --file ./login-feature.md
   → 解析 Markdown
   → 生成 Workflow
   → 保存到 SQLite
   → 启动执行

2. 自动执行流程:
   start → task-1(architect) → [task-2, task-3 并行]
   → task-4(tester) → task-5(等待人工审批)

3. cah workflow approve wf-a1b2c3 task-5
   → 继续执行 task-6 → end → 完成

   或

   cah workflow reject wf-a1b2c3 task-5 --reason "缺少测试"
   → 回到 task-2 重新执行（循环）
```

---

## 12. 注意事项

### 12.1 Redis 依赖
- BullMQ 需要 Redis 服务
- 开发环境可用 Docker: `docker run -d -p 6379:6379 redis:alpine`
- 生产环境建议使用托管 Redis

### 12.2 错误处理
- Job 失败自动重试（指数退避）
- 超过重试次数标记节点为 failed
- 工作流整体失败时通知用户

### 12.3 并发控制
- Worker 并发数可配置
- 同一工作流的节点按依赖顺序执行
- 不同工作流可并行执行
