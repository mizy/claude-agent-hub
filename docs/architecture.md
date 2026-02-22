# Claude Agent Hub 架构文档

## 概览

Claude Agent Hub 是一个自举式 AI 任务执行系统，目标是从工具进化为有生命力的自驱智能体。通过 Workflow 引擎自动分析、拆解和执行开发任务，支持多种 CLI 后端（claude-code/opencode/iflow/codebuddy/openai-compatible）和复杂的控制流（条件、循环、并行、定时、人工审批等）。内置 Memory 学习系统（含遗忘引擎、关联引擎、情景记忆）、Prompt 优化（含 A/B 测试）、分布式 Tracing、任务交互（暂停/恢复/注入）、SelfCheck 健康检查、SelfEvolve 自进化引擎和 SelfDrive 自驱引擎。

## 系统架构

与 CLAUDE.md 一致的 5 层分层架构：

```
┌─ 表现层 ──────────────────────────────────────────────────────────────────┐
│  cli/          命令行主入口、子命令          (@entry: cli/index.ts)         │
│  server/       HTTP 可视化面板（dashboard）   (@entry: server/index.ts)     │
│  report/       报告生成、趋势分析、退化检测   (@entry: report/index.ts)     │
│  messaging/    IM 交互（飞书 WSClient+卡片 / Telegram）                    │
├─ 业务层 ──────────────────────────────────────────────────────────────────┤
│  task/         任务生命周期（创建/执行/暂停/恢复/消息/注入）               │
│  workflow/     AI 工作流引擎（生成/执行/状态/队列/Worker）                 │
│  scheduler/    守护进程、事件总线、队列、Worker                            │
│  analysis/     项目上下文分析、历史学习、分类、时间预估                    │
│  output/       任务输出保存、标题生成                                      │
│  selfcheck/    7 项健康检查、自动修复、修复任务生成                        │
│  selfevolve/   失败分析→改进→验证→历史、信号检测                          │
│  selfdrive/    目标管理、调度器、daemon 集成、自驱状态                     │
├─ 集成层 ──────────────────────────────────────────────────────────────────┤
│  backend/      后端抽象（claude-code/opencode/iflow/codebuddy/openai）    │
│  memory/       记忆系统（语义/情景/遗忘/关联/检索）                       │
│  persona/      AI 人格定义与加载                                          │
│  prompts/      提示词模板                                                 │
│  prompt-optimization/  提示词自进化（失败分析/版本/A-B测试）              │
│  config/       YAML 配置加载、Schema 校验                                 │
├─ 持久层 ──────────────────────────────────────────────────────────────────┤
│  store/        GenericFileStore + 各专用 Store                            │
├─ 基础设施 ────────────────────────────────────────────────────────────────┤
│  shared/       Result<T,E>、AppError、日志、ID、时间、文本、事件总线       │
│  types/        共享类型定义                                               │
└───────────────────────────────────────────────────────────────────────────┘
```

### 数据存储结构

```
.cah-data/tasks/task-{id}/
  ├── task.json          # 任务元数据（id, title, status, priority, cwd, source）
  ├── workflow.json      # 工作流定义（节点、边、变量）
  ├── instance.json      # 唯一执行状态源（节点状态、输出、变量）
  ├── stats.json         # 聚合统计（从 instance 派生）
  ├── timeline.json      # 事件时间线
  ├── process.json       # 后台进程信息（PID）
  ├── messages.json      # 任务交互消息队列
  ├── logs/
  │   ├── execution.log       # 主执行日志
  │   ├── conversation.log    # 对话日志
  │   ├── events.jsonl        # JSONL 事件流
  │   └── conversation.jsonl  # JSONL 对话流
  ├── outputs/           # result.md
  └── traces/            # trace-{traceId}.jsonl（OTLP 兼容 Span）
```

## 目录结构

```
src/
├── cli/                        # CLI 命令入口
│   ├── index.ts               # @entry 主入口
│   └── commands/              # 子命令
│       ├── task.ts            # 任务主命令（分发到子文件）
│       ├── taskCreate.ts      # 创建任务
│       ├── taskLifecycle.ts   # 生命周期（stop/pause/resume/msg/inject）
│       ├── taskList.ts        # 列表查看
│       ├── taskLogs.ts        # 日志查看
│       ├── agent.ts           # Agent 管理
│       ├── daemon.ts          # 守护进程控制
│       ├── memory.ts          # Memory 操作
│       ├── prompt.ts          # Prompt 版本管理
│       ├── report.ts          # 报告生成
│       ├── server.ts          # Dashboard 启动
│       ├── trace.ts           # Tracing 查看
│       ├── init.ts            # 项目初始化
│       ├── backend.ts         # Backend 管理
│       ├── self.ts            # self 统一命令入口（check/evolve/drive/status）
│       ├── selfcheck.ts       # 系统自检（快捷方式）
│       ├── selfEvolve.ts      # 进化子命令（analyze/validate/history）
│       └── selfDrive.ts       # 自驱子命令（start/stop/status/goals/disable/enable）
│
├── backend/                    # CLI 后端抽象层
│   ├── index.ts               # @entry: invokeBackend(), resolveBackend()
│   ├── types.ts               # BackendAdapter, InvokeOptions, InvokeResult
│   ├── resolveBackend.ts      # 后端解析与注册
│   ├── promptBuilder.ts       # Prompt 组装（persona + mode）
│   ├── concurrency.ts         # Slot 并发控制
│   ├── backendConfig.ts        # Backend 配置 schema
│   ├── claudeCodeBackend.ts   # claude-code 适配器
│   ├── opencodeBackend.ts     # opencode 适配器
│   ├── iflowBackend.ts        # iflow 适配器
│   ├── codebuddyBackend.ts    # codebuddy 适配器
│   └── openaiCompatibleBackend.ts  # OpenAI API 兼容适配器
│
├── task/                       # Task 层：生命周期 + 执行 + 交互
│   ├── index.ts               # @entry
│   ├── createTask.ts          # 创建任务
│   ├── createTaskWithFolder.ts # 创建任务并初始化目录
│   ├── createAndRun.ts        # 创建并立即执行
│   ├── executeTask.ts         # 任务执行编排
│   ├── prepareExecution.ts    # 执行准备逻辑
│   ├── runTask.ts             # 运行任务核心
│   ├── spawnTask.ts           # 后台进程 spawn
│   ├── completeTask.ts        # 完成任务
│   ├── stopTask.ts            # 停止任务
│   ├── deleteTask.ts          # 删除任务
│   ├── pauseResumeTask.ts     # 暂停/恢复任务
│   ├── injectNode.ts          # 运行时注入工作流节点
│   ├── queryTask.ts           # 查询（list/get/poll）
│   ├── resumeTask.ts          # 恢复孤儿任务
│   ├── taskRecovery.ts        # 故障恢复
│   ├── manageTaskLifecycle.ts # 生命周期管理
│   ├── sendTaskNotify.ts      # 通知发送
│   ├── taskNotifications.ts   # 通知处理
│   ├── formatTask.ts          # 任务格式化显示
│   ├── processTracking.ts     # 进程追踪
│   ├── ExecutionProgress.ts   # 进度条
│   └── ExecutionStats.ts      # 执行统计
│
├── workflow/                   # Workflow 层：定义、状态、生成、执行
│   ├── index.ts               # @entry
│   ├── types.ts               # 类型 re-export（源自 types/workflow.ts）
│   ├── generateWorkflow.ts    # AI 生成工作流
│   ├── executeNode.ts         # 执行单个节点（使用 Persona）
│   ├── nodeTypeHandlers.ts    # 节点类型处理器
│   ├── nodeResultProcessor.ts # 节点结果处理
│   ├── logNodeExecution.ts    # 执行日志
│   ├── factory.ts             # Workflow 工厂函数
│   ├── engine/                # 引擎核心
│   │   ├── WorkflowEngine.ts
│   │   ├── WorkflowExecution.ts
│   │   ├── WorkflowLifecycle.ts
│   │   ├── WorkflowEventEmitter.ts
│   │   ├── StateManager.ts
│   │   ├── ConditionEvaluator.ts
│   │   ├── ExpressionEvaluator.ts
│   │   ├── RetryStrategy.ts
│   │   └── executeNewNodes.ts
│   ├── queue/                 # 队列与 Worker
│   │   ├── WorkflowQueue.ts
│   │   ├── NodeWorker.ts
│   │   ├── HumanApprovalQueue.ts
│   │   ├── queueLock.ts
│   │   └── queueMaintenance.ts
│   └── parser/                # 解析器
│       ├── parseJson.ts
│       └── parseMarkdown.ts
│
├── memory/                     # Memory 层：跨任务经验学习
│   ├── index.ts               # @entry
│   ├── manageMemory.ts        # Memory CRUD（add/list/remove/search）
│   ├── retrieveMemory.ts      # 相关性检索（关键词+项目+时间衰减评分）
│   ├── extractMemory.ts       # 从任务结果提取记忆
│   ├── extractChatMemory.ts   # 从对话提取记忆
│   ├── formatMemory.ts        # 格式化注入 Prompt
│   ├── migrateMemory.ts       # 记忆数据迁移（补充新字段）
│   ├── forgettingEngine.ts    # 遗忘引擎（间隔重复衰减）
│   ├── associationEngine.ts   # 关联引擎（记忆间双向关联图）
│   ├── extractEpisode.ts      # 情景记忆提取
│   ├── retrieveEpisode.ts     # 情景记忆检索
│   ├── injectEpisode.ts       # 情景记忆注入
│   └── types.ts               # MemoryEntry, MemoryCategory
│
├── prompt-optimization/        # Prompt 优化层：自动改进 Prompt
│   ├── index.ts               # @entry
│   ├── analyzeFailure.ts      # LLM 分析失败根因
│   ├── generateImprovement.ts # Textual gradient 改进 prompt
│   └── manageVersions.ts      # Prompt 版本管理
│
├── persona/                    # Persona 层：执行角色定义
│   ├── index.ts               # @entry
│   ├── builtinPersonas.ts     # 内置人格（Architect/Pragmatist 等）
│   ├── loadPersona.ts         # 加载人格配置
│   └── personaMcpConfig.ts    # MCP 配置
│
├── analysis/                   # Analysis 层：项目分析、学习、预估
│   ├── index.ts               # @entry
│   ├── analyzeProjectContext.ts
│   ├── learnFromHistory.ts
│   ├── TaskClassifier.ts
│   ├── PatternRecognizer.ts
│   └── estimateTime.ts
│
├── report/                     # 报告分析
│   ├── index.ts               # @entry
│   ├── ExecutionReport.ts     # 执行报告
│   ├── LiveSummary.ts         # 实时监控
│   ├── TrendAnalyzer.ts       # 趋势分析
│   ├── SummaryDataCollector.ts
│   ├── SummaryFormatter.ts
│   ├── analyzers/             # 分析器子模块
│   │   ├── dataCollector.ts
│   │   ├── CostAnalyzer.ts
│   │   ├── HeatmapAnalyzer.ts
│   │   └── TypeTrendAnalyzer.ts
│   └── comparison/            # 对比子模块
│       ├── dataCollector.ts
│       ├── MetricCalculator.ts
│       └── DegradationDetector.ts
│
├── store/                      # 数据存储
│   ├── index.ts               # @entry
│   ├── GenericFileStore.ts    # 通用文件存储
│   ├── TaskStore.ts           # 任务存储
│   ├── WorkflowStore.ts       # Workflow 存储
│   ├── TaskWorkflowStore.ts   # Task-Workflow 关系存储
│   ├── ExecutionStatsStore.ts # 执行统计存储
│   ├── TaskLogStore.ts        # 日志存储（JSONL）
│   ├── TaskMessageStore.ts    # 任务消息队列（暂停/恢复/注入命令）
│   ├── MemoryStore.ts         # 记忆存储
│   ├── TraceStore.ts          # Trace Span 存储（JSONL）
│   ├── PromptVersionStore.ts  # Prompt 版本存储
│   ├── UnifiedStore.ts        # 统一存储访问器
│   ├── createSpan.ts          # 创建 OpenTelemetry Spans
│   ├── exportOTLP.ts          # 导出 OTLP 格式
│   ├── paths.ts               # 路径常量
│   ├── readWriteJson.ts       # JSON 工具
│   └── types.ts               # 类型定义
│
├── messaging/                  # IM 交互层（原 notify/）
│   ├── index.ts               # @entry
│   ├── buildLarkCard.ts       # 飞书卡片构建器
│   ├── larkCardWrapper.ts     # 卡片渲染工具（Markdown 规范化）
│   ├── larkEventRouter.ts     # 飞书事件路由
│   ├── larkWsClient.ts        # 飞书 WebSocket 客户端
│   ├── sendLarkNotify.ts      # 发送飞书通知
│   ├── telegramClient.ts      # Telegram 客户端
│   ├── sendTelegramNotify.ts  # 发送 Telegram 通知
│   ├── larkCards/             # 飞书卡片组件
│   │   ├── cardElements.ts
│   │   ├── taskCards.ts
│   │   └── interactionCards.ts
│   └── handlers/              # 平台无关消息处理器
│       ├── messageRouter.ts   # 消息路由
│       ├── chatHandler.ts     # AI 对话
│       ├── commandHandler.ts  # 命令处理
│       ├── approvalHandler.ts # 审批处理
│       ├── streamingHandler.ts # 流式响应
│       ├── sessionManager.ts  # 会话管理
│       ├── taskCommands.ts    # 任务命令
│       ├── queryCommands.ts   # 查询命令
│       ├── systemCommands.ts  # 系统命令
│       ├── selfCommands.ts    # self 相关命令
│       ├── larkCardActions.ts # 飞书卡片按钮回调
│       ├── conversationLog.ts # 对话日志
│       ├── chatMemoryExtractor.ts # 对话记忆提取
│       ├── episodeExtractor.ts # 情景记忆提取
│       ├── imageExtractor.ts  # 图片提取
│       ├── resolveTaskId.ts   # 任务 ID 解析
│       ├── constants.ts
│       └── types.ts
│
├── scheduler/                  # 调度器
│   ├── index.ts               # @entry
│   ├── startDaemon.ts         # 启动守护进程
│   ├── stopDaemon.ts          # 停止
│   ├── restartDaemon.ts       # 重启
│   ├── getDaemonStatus.ts     # 状态查询
│   ├── showDaemonLogs.ts      # 日志显示
│   ├── createQueue.ts         # 创建任务队列
│   ├── createWorker.ts        # 创建 Worker
│   ├── pidLock.ts             # PID 锁
│   └── eventBus.ts            # 事件总线
│
├── server/                     # Web 服务器 + Dashboard
│   ├── createServer.ts        # HTTP 服务器
│   ├── routes.ts              # API 路由
│   └── dashboard/             # React 前端
│       ├── App.tsx
│       ├── main.tsx
│       ├── components/
│       │   ├── Sidebar.tsx
│       │   ├── RightPanel.tsx
│       │   ├── WorkflowCanvas.tsx
│       │   ├── DetailsTab.tsx
│       │   ├── LogsTab.tsx
│       │   ├── OutputTab.tsx
│       │   ├── TimelineTab.tsx
│       │   └── TraceTab.tsx   # Tracing 可视化
│       ├── hooks/
│       ├── store/
│       └── styles/
│
├── selfcheck/                  # 健康检查
│   ├── index.ts               # @entry
│   ├── types.ts               # 检查类型定义
│   └── checks/                # 7 项健康检查
│       ├── dataIntegrity.ts
│       ├── processHealth.ts
│       ├── envIsolation.ts
│       ├── versionConsistency.ts
│       ├── queueHealth.ts
│       ├── configValidity.ts
│       └── backendAvailability.ts
│
├── selfevolve/                 # 自进化引擎
│   ├── index.ts               # @entry
│   ├── signalDetector.ts      # @entry 信号检测器（异常模式检测）
│   ├── analyzeTaskPatterns.ts # 任务模式分析
│   ├── analyzeFailures.ts     # 失败分析
│   ├── analyzePerformance.ts  # 性能分析
│   ├── runEvolution.ts        # 执行进化周期
│   ├── applyImprovements.ts   # 应用改进
│   ├── reviewImprovement.ts   # 审查改进
│   ├── validateEvolution.ts   # 验证进化效果
│   ├── evolutionHistory.ts    # 进化历史
│   └── types.ts               # 进化类型定义
│
├── selfdrive/                  # 自驱引擎
│   ├── index.ts               # @entry
│   ├── goals.ts               # 目标管理（3 种内置目标）
│   ├── scheduler.ts           # 自驱调度器
│   └── daemon.ts              # Daemon 集成
│
├── shared/                     # 公共基础设施
│   ├── index.ts               # @entry
│   ├── result.ts              # Result<T, E> 类型
│   ├── error.ts               # AppError
│   ├── assertError.ts         # isError/getErrorMessage/ensureError
│   ├── logger.ts              # 日志
│   ├── formatTime.ts          # 时间格式化
│   ├── formatErrorMessage.ts  # 错误格式化
│   ├── generateId.ts          # ID 生成
│   ├── truncateText.ts        # 文本截断工具
│   ├── toInvokeError.ts       # 统一错误转换
│   ├── levenshtein.ts         # 编辑距离
│   ├── readClaudeConfig.ts    # 读取 CLAUDE.md 配置
│   └── events/                # 事件系统
│       └── taskEvents.ts      # 任务事件总线（task ↔ messaging 解耦）
│
├── config/                     # 配置系统
│   ├── index.ts               # @entry
│   ├── schema.ts              # 配置 Schema
│   ├── loadConfig.ts          # YAML 配置加载
│   └── initProject.ts         # 项目初始化
│
├── prompts/                    # Prompt 模板
│   ├── index.ts               # @entry
│   ├── taskPrompts.ts         # 任务执行 prompts
│   ├── chatPrompts.ts         # 对话 prompts
│   └── memoryPrompts.ts       # Memory prompts
│
├── output/                     # 输出处理
│   ├── index.ts               # @entry
│   ├── saveWorkflowOutput.ts  # 保存工作流输出
│   └── generateTaskTitle.ts   # 自动生成任务标题
│
└── types/                      # 全局类型定义
    ├── index.ts               # @entry barrel export
    ├── task.ts                # Task 类型 + helpers
    ├── taskStatus.ts          # TaskStatus helpers
    ├── workflow.ts            # Workflow/Node/Instance 全部类型
    ├── nodeStatus.ts          # NodeStatus/WorkflowStatus helpers
    ├── persona.ts             # PersonaConfig
    ├── output.ts              # ExecutionTiming
    ├── taskMessage.ts         # TaskMessage（暂停/恢复/注入命令）
    ├── trace.ts               # Span, SpanKind, TraceContext, OTLP 映射
    └── promptVersion.ts       # PromptVersion, FailureAnalysis
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
│  3. 写入 task.json（含 cwd 用于同项目冲突检测）                     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  executeTask(task, options)                                      │
│  1. 分析项目上下文(Analysis)                                      │
│  2. 学习历史执行(ExecutionHistory)                                │
│  3. 检索相关记忆(Memory)                                          │
│  4. 更新状态: pending → planning                                  │
│  5. 调用 generateWorkflow()                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  generateWorkflow(task, context)                                 │
│                                                                  │
│  buildWorkflowPrompt() → invokeBackend({                         │
│    prompt: "分析任务并生成 workflow...",                          │
│    mode: 'plan', persona: 'architect'                           │
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
│  4. 创建 Root Span (Tracing)                                     │
│  5. 启动 NodeWorker 循环执行节点                                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  executeNode(node, instance)                                     │
│                                                                  │
│  创建 Node Span → switch(node.type) {                           │
│    case 'task':                                                  │
│      invokeBackend({                                             │
│        prompt: node.task.prompt,                                │
│        persona: node.task.persona,                              │
│        traceCtx: nodeSpan,                                      │
│        onChunk: (chunk) => updateProgress(chunk)                │
│      })                                                          │
│    case 'delay':                                                 │
│      await delay(config.value, config.unit)                     │
│    case 'human':                                                 │
│      sendNotification() → 等待审批                               │
│    case 'loop', 'foreach', 'condition', 'switch':               │
│      executeControlFlowNode()                                   │
│    ...                                                           │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  完成任务                                                         │
│  1. 更新 instance.json（最终状态）                                 │
│  2. 生成 stats.json（从 instance 派生）                            │
│  3. 生成 outputs/result.md                                       │
│  4. 更新状态: developing → completed/failed                      │
│  5. 提取记忆(extractMemory)                                       │
│  6. 分析失败并优化 Prompt (如果失败)                               │
│  7. 发送通知(飞书/Telegram)                                       │
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
  status: TaskStatus      // pending → planning → developing → completed/failed/cancelled/stopped
  persona?: string        // Persona 名称
  backend?: string        // 使用的后端
  cwd?: string            // 工作目录（用于同项目冲突检测）
  output?: TaskOutput
  createdAt: string
  updatedAt?: string
}
```

### Backend 接口

```typescript
interface BackendAdapter {
  name: string
  displayName: string
  cliBinary: string
  capabilities: BackendCapabilities
  invoke(options: InvokeOptions): Promise<Result<InvokeResult, InvokeError>>
  checkAvailable(): Promise<boolean>
}

interface InvokeOptions {
  prompt: string
  mode?: 'plan' | 'execute' | 'review'
  persona?: PersonaConfig
  stream?: boolean
  onChunk?: (chunk: string) => void
  timeoutMs?: number
  sessionId?: string
  model?: string
  traceCtx?: TraceContext   // 用于创建 LLM child span
}

interface InvokeResult {
  response: string
  durationMs: number
  sessionId?: string
  durationApiMs?: number
  costUsd?: number
  slotWaitMs?: number
}

type InvokeError =
  | { type: 'timeout'; message: string }
  | { type: 'process'; message: string; exitCode?: number }
  | { type: 'cancelled'; message: string }
```

### Workflow

```typescript
interface Workflow {
  id: string
  taskId: string
  name: string
  description: string
  version: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables: Record<string, unknown>
  inputs?: InputDefinition[]
  outputs?: Record<string, string>
  settings?: WorkflowSettings
}

type NodeType = 'start' | 'end' | 'task' | 'condition' | 'parallel' | 'join'
  | 'human' | 'delay' | 'schedule' | 'loop' | 'foreach' | 'switch'
  | 'assign' | 'script'

interface WorkflowInstance {
  id: string
  workflowId: string
  status: WorkflowStatus
  nodeStates: Record<string, NodeState>
  variables: Record<string, unknown>
  outputs: Record<string, unknown>
  loopCounts: Record<string, number>
  activeLoops?: Record<string, unknown>
  pausedAt?: string
  pauseReason?: string
  startedAt?: string
  completedAt?: string
  error?: string
}
```

### Tracing

```typescript
type SpanKind = 'workflow' | 'node' | 'llm' | 'tool' | 'internal'

interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: SpanKind
  status: SpanStatus
  startTime: number
  endTime?: number
  attributes: SpanAttributes    // task.id, workflow.id, llm.backend 等
  tokenUsage?: TokenUsage
  cost?: SpanCost
  error?: SpanError
}

// 4 层 Span 层次: workflow → node → llm → (tool, internal)
```

### Memory

```typescript
type MemoryCategory = 'pattern' | 'lesson' | 'preference' | 'pitfall' | 'tool'

interface MemoryEntry {
  id: string
  content: string
  category: MemoryCategory
  keywords: string[]
  source: { type: 'task' | 'manual' | 'chat'; taskId?: string }
  confidence: number
  projectPath?: string
  createdAt: string
  accessCount: number
  // 遗忘曲线相关
  strength?: number           // 记忆强度 (0-100)
  stability?: number          // 稳定性
  reinforceCount?: number     // 强化次数
  lastReinforcedAt?: string   // 最后强化时间
}
```

## 通知系统 (Messaging)

支持飞书和 Telegram 两种通知渠道，提供双向对话终端能力。

### 消息处理架构

平台无关的 handlers 层处理核心逻辑，飞书/Telegram 各自的客户端层负责协议适配：

```
incoming message → messageRouter → commandHandler / chatHandler / approvalHandler
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              taskCommands         queryCommands        systemCommands
              (run/stop/pause      (list/get/logs       (reload/status
               resume/inject)      snapshot)             help)
```

### 飞书集成

- **larkWsClient**: WebSocket 客户端，接收消息/卡片按钮回调/入群事件
- **larkEventRouter**: 事件路由，分发到不同 handler
- **larkCards/**: 卡片组件（taskCards + interactionCards + cardElements）
- **sendLarkNotify**: 发送卡片/文本消息（API 优先，webhook 降级）

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

### Telegram 集成

- **telegramClient**: 长轮询客户端
- **sendTelegramNotify**: 消息发送
- 共享 handlers 层（commandHandler, chatHandler 等）

## 状态流转

### Task 状态机

```
pending ──────► planning ──────► developing ──────► completed
    │              │                 │                  │
    │              │                 ├──► paused ──► developing
    │              │                 │
    │              │                 ▼
    │              └────────────► failed
    │
    ├──────────────────────────► cancelled
    └──────────────────────────► stopped
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

- [x] Workflow 引擎（14 种节点类型，条件、循环、并行、定时等）
- [x] 多 Backend 支持（claude-code/opencode/iflow/codebuddy/openai-compatible）
- [x] Persona 系统（9 种内置人格）
- [x] 飞书通知（WebSocket + 双向对话 + 交互式卡片 + 按钮回调）
- [x] Telegram 通知（长轮询 + 对话终端）
- [x] 项目上下文分析与历史学习
- [x] 时间预估（ETA）
- [x] 任务报告（趋势分析/实时监控/执行对比/退化检测/成本分析）
- [x] Web Dashboard（workflow 可视化 + Tracing 面板）
- [x] 后台守护进程 + 事件总线
- [x] Memory 学习系统（跨任务经验提取、相关性检索、Prompt 注入、遗忘引擎、关联引擎、情景记忆）
- [x] Prompt 优化（失败分析 + Textual Gradient 改进 + 版本管理 + A/B 测试）
- [x] 分布式 Tracing（4 层 Span 层次，OpenTelemetry 兼容）
- [x] 任务交互（暂停/恢复/注入节点/消息队列）
- [x] 同项目冲突检测（cwd 自动串行）
- [x] 孤儿任务自动恢复

- [x] Selfcheck 框架（7 项检查 + 自动修复 + 修复任务生成）
- [x] 任务审核流程（complete/reject）
- [x] SelfEvolve 进化引擎（失败分析 → 改进 → 验证 → 历史 + 信号检测器）
- [x] SelfDrive 自驱引擎（3 种内置目标 + 调度器 + daemon 集成 + 永久禁用/启用）
- [x] 事件驱动解耦（taskEventBus + workflowEvents，task ↔ messaging 解耦）

## 扩展方向

- [ ] Selfcheck 自愈循环（定时自动执行 + cron 挂载）
- [ ] Workflow 模板库（成功策略自动提取）
- [ ] 分布式执行
- [ ] Multi-Agent 协作（专业化 Agent 团队、任务分发、冲突检测）
- [ ] 能力边界追踪（按任务类型统计成功率）
- [ ] 跨项目知识迁移
