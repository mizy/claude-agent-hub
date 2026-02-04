# Claude Agent Hub

基于 Claude Code CLI 的自举式 AI 任务系统。可以用自己来维护和开发自己。

## 核心命令

```bash
cah "任务描述"           # 创建并执行任务
cah "任务描述" -F        # 前台运行（可看日志）
cah "任务描述" --no-run  # 仅创建不执行
cah "任务描述" -d <path> # 指定数据目录
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
│   └── commands/            # 子命令
│       ├── task.ts          # 任务管理
│       ├── template.ts      # 模板系统
│       ├── report.ts        # 报告分析
│       └── daemon.ts        # 守护进程
│
├── task/                     # 任务管理与执行
│   ├── index.ts             # 统一导出
│   ├── createTask.ts        # 任务创建
│   ├── createAndRun.ts      # 创建并运行
│   ├── executeTask.ts       # 任务执行器（进度条、ETA、统计）
│   ├── runTask.ts           # 任务执行入口
│   ├── ExecutionProgress.ts # 进度条和 ETA 显示
│   ├── ExecutionStats.ts    # 统计收集
│   ├── manageTaskLifecycle.ts # 生命周期（delete/clear/stop/complete）
│   ├── queryTask.ts         # 查询（list/get/poll）
│   └── resumeTask.ts        # 恢复任务
│
├── workflow/                 # Workflow 引擎
│   ├── types.ts             # 类型定义
│   ├── generateWorkflow.ts  # AI 生成 Workflow
│   ├── executeNode.ts       # 执行节点（使用 Persona）
│   ├── logNodeExecution.ts  # 节点执行日志（timeline + jsonl）
│   ├── engine/              # 状态管理、节点执行
│   │   ├── WorkflowEngine.ts
│   │   ├── StateManager.ts
│   │   ├── RetryStrategy.ts     # 智能重试
│   │   └── WorkflowEventEmitter.ts # 事件驱动
│   └── queue/               # NodeWorker, WorkflowQueue
│
├── persona/                  # Persona 人格系统
│   ├── index.ts             # 统一导出
│   ├── builtinPersonas.ts   # 内置 Persona 定义
│   └── loadPersona.ts       # Persona 加载
│
├── analysis/                 # 分析模块
│   ├── index.ts             # 统一导出
│   ├── analyzeProjectContext.ts # 项目上下文分析
│   ├── learnFromHistory.ts  # 历史学习入口
│   ├── TaskClassifier.ts    # 任务分类器
│   ├── PatternRecognizer.ts # 模式识别
│   ├── historyTypes.ts      # 历史类型定义
│   └── estimateTime.ts      # 时间预估
│
├── template/                 # 任务模板系统
│   ├── TaskTemplate.ts      # 入口（barrel export）
│   ├── types.ts             # 类型定义
│   ├── TemplateCore.ts      # 核心模板管理
│   ├── TemplateScoring.ts   # 有效性评分
│   ├── TemplateSuggestion.ts # 模板推荐
│   ├── TemplateFromTask.ts  # 从历史任务生成
│   └── builtinTemplates.ts  # 12个内置模板
│
├── report/                   # 报告分析
│   ├── generateReport.ts    # 工作报告
│   ├── TrendAnalyzer.ts     # 趋势分析入口
│   ├── LiveSummary.ts       # 实时摘要（队列预览、ETA）
│   ├── ExecutionComparison.ts # 执行对比（退化检测，barrel export）
│   ├── ExecutionReport.ts   # 执行报告
│   ├── analyzers/           # 趋势分析子模块
│   │   ├── TypeTrendAnalyzer.ts  # 类型趋势
│   │   ├── HeatmapAnalyzer.ts    # 热力图
│   │   ├── CostAnalyzer.ts       # 成本优化
│   │   ├── dataCollector.ts      # 数据收集
│   │   └── formatters.ts         # 格式化输出
│   └── comparison/          # 执行对比子模块
│       ├── types.ts              # 类型定义
│       ├── dataCollector.ts      # 任务数据收集
│       ├── MetricCalculator.ts   # 指标计算
│       ├── DegradationDetector.ts # 退化检测
│       └── formatters.ts         # 格式化输出
│
├── claude/                   # Claude Code 集成
│   └── invokeClaudeCode.ts  # CLI 调用封装
│
├── store/                    # 文件存储
│   ├── GenericFileStore.ts  # 通用文件存储（支持目录模式）
│   ├── UnifiedStore.ts      # 统一存储接口
│   ├── TaskStore.ts         # 任务存储
│   ├── WorkflowStore.ts     # Workflow 存储
│   ├── ExecutionStatsStore.ts # 执行统计
│   └── paths.ts             # 路径常量（TASK_PATHS/FILE_NAMES）
│
├── scheduler/                # 调度模块
│   ├── index.ts             # @entry 统一导出
│   ├── createQueue.ts       # 任务队列
│   ├── createWorker.ts      # Worker
│   ├── startDaemon.ts       # 守护进程
│   └── eventBus.ts          # 事件总线
│
├── notify/                   # 通知模块
│   ├── index.ts             # @entry 统一导出
│   ├── sendLarkNotify.ts    # 飞书消息发送
│   └── larkServer.ts        # 飞书服务
│
├── config/                   # 配置模块
│   ├── index.ts             # 统一导出
│   ├── loadConfig.ts        # 配置加载
│   └── schema.ts            # 配置 Schema
│
├── output/                   # 输出模块
│   ├── index.ts             # 统一导出
│   ├── generateTaskTitle.ts # 任务标题生成
│   └── saveWorkflowOutput.ts # 输出保存
│
├── prompts/                  # Prompt 模板
│   └── taskPrompts.ts       # Workflow 生成 prompt
│
├── types/                    # 全局类型定义
│   ├── task.ts              # Task 类型
│   ├── persona.ts           # Persona 类型
│   └── output.ts            # Output 类型
│
└── shared/                   # 公共模块（纯基础设施，无业务逻辑）
    ├── error.ts             # 统一错误处理（AppError）
    ├── result.ts            # Result<T, E> 类型
    ├── logger.ts            # 日志
    ├── generateId.ts        # ID 生成
    └── formatTime.ts        # 时间格式化（formatDuration 等）
```

## 数据结构

数据目录默认为 `.cah-data/`，可通过以下方式指定：
- 命令行参数：`cah "任务" -d /path/to/data`
- 环境变量：`CAH_DATA_DIR=/path/to/data`

```
.cah-data/tasks/
└── task-20260201-HHMMSS-xxx/
    ├── task.json          # 任务元数据（id, title, description, status, priority）
    ├── workflow.json      # 工作流定义（节点、边、变量）
    ├── instance.json      # 执行状态（唯一权威数据源：节点状态、输出、变量）
    ├── stats.json         # 聚合统计（从 instance 派生，用于快速查看）
    ├── timeline.json      # 事件时间线（包含 instanceId 用于区分不同执行）
    ├── process.json       # 后台进程信息
    ├── logs/
    │   ├── execution.log  # 执行日志
    │   └── events.jsonl   # 结构化事件日志（JSONL 格式）
    └── outputs/
        └── result.md      # 执行完成后的 Markdown 报告
```

### 各文件职责说明

| 文件 | 职责 |
|------|------|
| **task.json** | 任务元数据（不含执行细节） |
| **workflow.json** | 工作流定义（节点、边、变量等） |
| **instance.json** | **唯一的执行状态源**（节点状态、输出、变量） |
| **stats.json** | 聚合统计（从 instance 派生） |
| **timeline.json** | 事件时间线（包含 instanceId 用于过滤） |
| **process.json** | 后台进程信息 |
| **result.md** | 执行完成后的 Markdown 报告 |

### Timeline 格式

Timeline 事件包含 `instanceId` 字段（必填），用于区分不同执行实例：

```typescript
interface ExecutionTimeline {
  timestamp: string
  event: 'workflow:started' | 'workflow:resumed' | 'node:started' | 'node:completed' | 'node:failed' | 'workflow:completed' | 'workflow:failed'
  instanceId: string  // 必填，用于区分不同执行实例
  nodeId?: string
  nodeName?: string
  details?: string
}
```

**相关 API**：
- `getTimelineForInstance(taskId, instanceId)` - 获取指定 instance 的事件
- `clearTimelineForNewInstance(taskId, newInstanceId, mode)` - 清理旧事件

## 任务执行流程

1. `cah "描述"` → 创建 task 文件夹
2. 分析项目上下文 (analysis/analyzeProjectContext.ts)
3. 学习历史经验 (analysis/learnFromHistory.ts)
4. AI 生成 workflow.json (workflow/generateWorkflow.ts)
5. NodeWorker 执行节点 → 使用 Persona → 调用 Claude Code
6. 增量保存统计 → 结果写入 instance.json

## 关键文件

| 文件 | 作用 |
|------|------|
| `cli/index.ts` | CLI 主入口 |
| `task/index.ts` | Task 模块统一导出 |
| `task/runTask.ts` | 任务执行主流程 |
| `task/executeTask.ts` | 任务执行器（进度条、ETA、统计） |
| `task/manageTaskLifecycle.ts` | 任务生命周期操作 |
| `task/queryTask.ts` | 任务查询操作 |
| `workflow/generateWorkflow.ts` | AI 生成 Workflow |
| `workflow/executeNode.ts` | 执行节点（使用 Persona） |
| `workflow/logNodeExecution.ts` | 节点执行日志（timeline + jsonl） |
| `persona/loadPersona.ts` | Persona 加载 |
| `analysis/analyzeProjectContext.ts` | 项目类型/框架/结构分析 |
| `analysis/learnFromHistory.ts` | 历史学习入口 |
| `analysis/estimateTime.ts` | 时间预估（历史分析、置信度） |
| `template/TemplateCore.ts` | 模板核心管理 |
| `template/TemplateSuggestion.ts` | 模板推荐 |
| `report/TrendAnalyzer.ts` | 趋势分析入口 |
| `report/analyzers/CostAnalyzer.ts` | 成本优化分析 |
| `store/GenericFileStore.ts` | 通用文件存储 |
| `store/TaskStore.ts` | 任务存储（基于 GenericFileStore） |
| `shared/error.ts` | 统一错误处理（AppError） |
| `workflow/engine/StateManager.ts` | 状态管理（WORKFLOW_STATE/NODE_STATE_MARK） |

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
- 类文件: PascalCase (`UnifiedStore.ts`)
- `@entry` 标记模块主入口点

## 自举友好性

项目设计支持 AI 自举升级：

1. **模块入口清晰**：每个模块的 index.ts 使用 `@entry` 注释标记，包含模块能力概述
2. **导出分类明确**：index.ts 按功能分组导出，便于理解模块 API
3. **关键文件表**：CLAUDE.md 维护关键文件列表，便于定位核心逻辑
4. **文件行数限制**：单文件不超过 500 行，超出时按职责拆分

## @entry 模块索引

| 模块 | 入口文件 | 核心能力 |
|------|----------|----------|
| CLI | `cli/index.ts` | 命令行主入口、任务创建 |
| Task | `task/index.ts` | 任务创建、执行、查询、生命周期 |
| Workflow | `workflow/index.ts` | 工作流定义、执行、状态管理 |
| Store | `store/index.ts` | 文件存储、持久化 |
| Analysis | `analysis/index.ts` | 上下文分析、历史学习、时间预估 |
| Template | `template/TaskTemplate.ts` | 模板管理、推荐、评分 |
| Report | `report/index.ts` | 报告生成、趋势分析、实时监控 |
| Persona | `persona/index.ts` | AI 人格定义、加载 |
| Scheduler | `scheduler/index.ts` | 任务队列、Worker、守护进程 |
| Notify | `notify/index.ts` | 飞书消息通知 |
| Shared | `shared/index.ts` | Result 类型、错误处理、日志、ID 生成 |
