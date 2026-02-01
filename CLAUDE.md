# Claude Agent Hub

基于 Claude Code CLI 的自举式 AI 任务系统。可以用自己来维护和开发自己。

## 核心命令

```bash
cah "任务描述"           # 创建并执行任务
cah "任务描述" -F        # 前台运行（可看日志）
cah "任务描述" --no-run  # 仅创建不执行
cah task list            # 查看任务列表
cah task logs <id> -f    # 实时查看任务日志
cah task resume <id>     # 恢复中断的任务
```

## 架构

```
src/
├── cli/                    # CLI 入口
│   ├── index.ts           # @entry 主入口
│   └── commands/          # 子命令 (task, agent, daemon, report)
│
├── agent/                  # Agent 核心
│   ├── runAgentForTask.ts # 任务执行入口
│   ├── generateWorkflow.ts # AI 生成 Workflow
│   └── executeWorkflowNode.ts # 执行节点
│
├── workflow/               # Workflow 引擎 (内部使用)
│   ├── types.ts           # 类型定义
│   ├── engine/            # 状态管理、节点执行
│   └── queue/             # NodeWorker, WorkflowQueue
│
├── claude/                 # Claude Code 集成
│   └── invokeClaudeCode.ts # CLI 调用封装
│
├── task/                   # 任务管理
│   ├── createTaskWithFolder.ts
│   ├── resumeTask.ts
│   └── stopTask.ts
│
├── store/                  # 文件存储
│   ├── TaskStore.ts       # 任务存储
│   ├── WorkflowStore.ts   # Workflow 存储
│   └── paths.ts           # 路径常量
│
└── shared/                 # 公共模块
    ├── result.ts          # Result<T, E> 类型
    └── logger.ts          # 日志
```

## 数据结构

```
data/tasks/
└── task-20260201-HHMMSS-xxx/
    ├── task.json          # 任务元数据
    ├── workflow.json      # 生成的 workflow
    ├── instance.json      # 执行状态
    ├── process.json       # 进程信息
    └── logs/
        └── execution.log  # 执行日志
```

## 任务执行流程

1. `cah "描述"` → 创建 task 文件夹
2. AI 分析任务 → 生成 workflow.json
3. NodeWorker 执行节点 → 调用 Claude Code
4. 结果写入 instance.json

## 关键文件

| 文件 | 作用 |
|------|------|
| `cli/index.ts` | CLI 主入口 |
| `agent/runAgentForTask.ts` | 任务执行主流程 |
| `agent/generateWorkflow.ts` | AI 生成 Workflow |
| `claude/invokeClaudeCode.ts` | Claude CLI 封装 |
| `store/TaskStore.ts` | 任务文件操作 |

## 开发

```bash
npm run dev       # 开发模式
npm run build     # 构建
npm run lint      # Lint
npm run typecheck # 类型检查
npm test          # 测试
```

## 命名规范

- 文件: 动词+名词 (`createTask.ts`)
- 函数: 动词+名词 (`createTask()`)
- `@entry` 标记入口点
