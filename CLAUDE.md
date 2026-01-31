# Claude Agent Hub

## 项目概述
基于 Claude Code CLI 的 AI 任务调度系统，通过 Workflow 引擎自动分析、规划和执行开发任务。

## 架构

```
src/
├── cli/                    # CLI 命令入口
│   ├── index.ts           # @entry 主入口
│   ├── output.ts          # 统一输出格式
│   └── commands/          # 子命令 (task, workflow, agent, daemon)
│
├── agent/                  # Agent 核心逻辑
│   ├── runAgentForTask.ts # 任务执行入口
│   ├── generateWorkflow.ts # 生成 Workflow
│   ├── executeWorkflowNode.ts # 执行节点
│   └── persona/           # Agent 人格配置
│
├── workflow/               # Workflow 引擎
│   ├── types.ts           # 类型定义
│   ├── engine/            # 状态管理、条件求值、节点执行
│   ├── queue/             # NodeWorker, WorkflowQueue
│   ├── parser/            # JSON/Markdown 解析
│   └── store/             # Workflow 存储
│
├── claude/                 # Claude Code 集成
│   └── invokeClaudeCode.ts # Claude CLI 调用 (返回 Result 类型)
│
├── task/                   # 任务管理
│   ├── createTaskWithFolder.ts
│   ├── listTasks.ts
│   └── resumeTask.ts
│
├── store/                  # 数据存储 (文件系统)
│   ├── TaskStore.ts       # 任务文件存储
│   └── fileStore.ts       # Agent 存储
│
├── notify/                 # 通知系统
│   └── lark.ts            # 飞书通知
│
├── shared/                 # 公共基础设施
│   ├── result.ts          # Result<T, E> 类型
│   ├── logger.ts          # 日志系统
│   └── time.ts            # 时间处理
│
├── scheduler/              # 调度核心
│   ├── startDaemon.ts     # 守护进程
│   └── worker.ts          # Worker 抽象
│
└── prompts/                # Prompt 模板
    └── taskPrompts.ts
```

## 核心模块

### workflow/ - Workflow 引擎
- 支持多种节点类型：task, delay, schedule, loop, foreach, switch, assign, script, human, parallel, join
- 基于 DAG 的执行引擎
- 表达式求值 (expr-eval)

### claude/ - Claude Code 调用
- `invokeClaudeCode()`: 返回 `Result<InvokeResult, InvokeError>`
- 支持流式输出 (`stream: true`)
- 自动跳过权限确认 (`--dangerously-skip-permissions`)

### store/ - 数据存储
- 文件系统存储，无需数据库
- 任务按状态组织：`data/tasks/{status}/task-{id}/`
- 每个任务独立文件夹，包含 task.json, workflow.json, instance.json

## 命名约定
- 文件名: 动词 + 名词 (`createTask.ts`, `executeNode.ts`)
- 函数: 动词 + 名词 (`createTask`, `executeNode`)
- `@entry` 标记主入口点

## 关键文件
- `src/cli/index.ts`: @entry CLI 主入口
- `src/agent/runAgentForTask.ts`: 任务执行流程
- `src/agent/generateWorkflow.ts`: 生成 JSON Workflow
- `src/agent/executeWorkflowNode.ts`: 执行单个节点
- `src/claude/invokeClaudeCode.ts`: Claude CLI 调用
- `src/workflow/types.ts`: Workflow 类型定义
- `src/workflow/engine/executeNewNodes.ts`: 新节点执行器

## 技术栈
- Node.js 20+, TypeScript 5.5+
- Commander.js (CLI)
- execa (进程)
- expr-eval (表达式求值)
- zod (配置验证)
- chalk/ora (终端 UI)

## 开发命令
```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run lint         # ESLint 检查
npm run typecheck    # 类型检查
npm test             # 运行测试
```
