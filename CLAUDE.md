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
cah template use <id>    # 使用模板创建任务
cah template suggest <d> # 根据描述推荐模板
cah template from-task   # 从历史任务创建模板
cah template ranking     # 模板有效性排行榜
cah report trend         # 趋势分析报告
cah report live          # 实时状态监控
```

## 架构

```
src/
├── cli/                      # CLI 入口
│   ├── index.ts             # @entry 主入口
│   ├── errors.ts            # 结构化错误提示
│   └── commands/            # 子命令
│       ├── task.ts          # 任务管理
│       ├── template.ts      # 模板系统
│       ├── report.ts        # 报告分析
│       └── daemon.ts        # 守护进程
│
├── agent/                    # 任务执行核心
│   ├── runAgentForTask.ts   # 任务执行入口
│   ├── executeAgent.ts      # 任务执行器（进度条、ETA、统计）
│   ├── generateWorkflow.ts  # AI 生成 Workflow
│   ├── executeWorkflowNode.ts # 执行节点（使用 Persona）
│   ├── projectContext.ts    # 项目上下文分析
│   ├── executionHistory.ts  # 历史学习（任务分类、节点模式）
│   ├── timeEstimator.ts     # 时间预估（基于历史数据）
│   └── persona/             # Persona 人格系统
│       ├── builtinPersonas.ts  # 内置 Persona 定义
│       └── loadPersona.ts      # Persona 加载
│
├── workflow/                 # Workflow 引擎 (内部使用)
│   ├── types.ts             # 类型定义
│   ├── engine/              # 状态管理、节点执行
│   │   ├── WorkflowEngine.ts
│   │   ├── StateManager.ts
│   │   ├── RetryStrategy.ts     # 智能重试
│   │   └── WorkflowEventEmitter.ts # 事件驱动
│   └── queue/               # NodeWorker, WorkflowQueue
│
├── template/                 # 任务模板系统
│   └── TaskTemplate.ts      # 12个内置模板 + 自定义模板
│
├── report/                   # 报告分析
│   ├── generateReport.ts    # 工作报告
│   ├── TrendAnalyzer.ts     # 趋势分析（类型统计、热力图、成本优化）
│   ├── LiveSummary.ts       # 实时摘要（队列预览、ETA）
│   ├── ExecutionComparison.ts # 执行对比（退化检测）
│   └── ExecutionReport.ts   # 执行报告
│
├── claude/                   # Claude Code 集成
│   └── invokeClaudeCode.ts  # CLI 调用封装
│
├── task/                     # 任务管理
│   ├── createTaskWithFolder.ts
│   ├── resumeTask.ts
│   └── stopTask.ts
│
├── store/                    # 文件存储
│   ├── TaskStore.ts         # 任务存储
│   ├── WorkflowStore.ts     # Workflow 存储
│   ├── ExecutionStatsStore.ts # 执行统计
│   └── paths.ts             # 路径常量
│
├── prompts/                  # Prompt 模板
│   └── taskPrompts.ts       # Workflow 生成 prompt
│
└── shared/                   # 公共模块
    ├── result.ts            # Result<T, E> 类型
    └── logger.ts            # 日志
```

## 数据结构

数据目录默认为 `.cah-data/`，可通过环境变量 `CAH_DATA_DIR` 覆盖。

```
.cah-data/tasks/
└── task-20260201-HHMMSS-xxx/
    ├── task.json          # 任务元数据
    ├── workflow.json      # 生成的 workflow
    ├── instance.json      # 执行状态
    ├── stats.json         # 执行统计（增量保存）
    ├── process.json       # 进程信息
    └── logs/
        └── execution.log  # 执行日志
```

## 任务执行流程

1. `cah "描述"` → 创建 task 文件夹
2. 分析项目上下文 (projectContext.ts)
3. 学习历史经验 (executionHistory.ts)
4. AI 生成 workflow.json (generateWorkflow.ts)
5. NodeWorker 执行节点 → 调用 Claude Code
6. 增量保存统计 → 结果写入 instance.json

## 关键文件

| 文件 | 作用 |
|------|------|
| `cli/index.ts` | CLI 主入口 |
| `cli/errors.ts` | 结构化错误提示（9种分类） |
| `agent/runAgentForTask.ts` | 任务执行主流程 |
| `agent/executeAgent.ts` | 任务执行器（进度条、ETA、统计） |
| `agent/executeWorkflowNode.ts` | 节点执行（Persona 在此应用） |
| `agent/generateWorkflow.ts` | AI 生成 Workflow |
| `agent/projectContext.ts` | 项目类型/框架/结构分析 |
| `agent/executionHistory.ts` | 历史学习（任务分类、节点模式、失败分析） |
| `agent/timeEstimator.ts` | 时间预估（历史分析、置信度） |
| `template/TaskTemplate.ts` | 模板系统（推荐、有效性评分、从任务创建） |
| `report/TrendAnalyzer.ts` | 趋势分析（类型统计、热力图、成本优化） |
| `report/LiveSummary.ts` | 实时监控（队列预览、ETA） |
| `report/ExecutionComparison.ts` | 执行对比（退化检测、趋势对比） |
| `claude/invokeClaudeCode.ts` | Claude CLI 封装 |
| `store/TaskStore.ts` | 任务文件操作 |
| `store/ExecutionStatsStore.ts` | 执行统计存储 |
| `workflow/engine/RetryStrategy.ts` | 智能重试策略 |
| `workflow/engine/WorkflowEventEmitter.ts` | 事件驱动 |

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
