# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-02-01

### Added
- **时间预估系统** (`src/agent/timeEstimator.ts`) - 基于历史数据预估任务剩余时间
  - 历史执行时间分析（从 stats.json 加载）
  - 多层次预估：同名节点 → 同类型节点 → 全局平均
  - 置信度计算（高/中/低）
  - 60 秒 TTL 缓存机制
- **执行对比分析** (`src/report/ExecutionComparison.ts`) - 性能退化检测
  - 任务执行对比 (`compareTasksById`)
  - 性能退化报告 (`generateRegressionReport`)
  - 自动识别相似任务进行对比
  - 检测时间/成本退化（>20%/30%）和改进
  - 终端和 Markdown 格式化输出
- **模板推荐系统** - 智能模板匹配
  - `cah template suggest <description>` - 基于任务描述推荐模板
  - 多维度评分：关键词匹配、标签匹配、任务类型、有效性、使用频率
- **模板有效性评分** - 基于历史成功率的模板排名
  - `cah template ranking` - 查看模板有效性排行榜
  - `cah template recalculate` - 重新计算有效性评分
  - `effectivenessScore`、`successCount`、`failureCount` 字段
- **从历史任务创建模板** - 自动提取成功模式
  - `cah template from-task [taskId]` - 从已完成任务创建模板
  - 自动提取执行步骤作为参考
  - 识别任务类型并映射分类
- **任务类型分类** (`TaskCategory`) - git/refactor/feature/fix/docs/test/iteration/other
- **节点模式提取** - 记录成功任务的节点序列模式
- **按类型推荐节点数** - 根据同类型成功任务计算推荐
- 新增 `timeEstimator.test.ts` 测试（26 个用例）
- 新增 `ExecutionComparison.test.ts` 测试（26 个用例）

### Changed
- **进度条显示增强** (`src/agent/executeAgent.ts`)
  - 添加 ETA 显示 `ETA: ~2m30s`
  - 降低更新频率（至少间隔 3 秒）
  - 置信度标识：高无标识，中用 `~`，低用 `≈`
- **错误恢复能力增强** (`src/workflow/engine/RetryStrategy.ts`)
  - 更多暂时性错误识别：`temporarily unavailable`、`connection reset`、`epipe`、`enotfound`、`etimedout`
  - API 过载时建议等待 15 秒
  - 更多可恢复错误：`capacity`、`please try again`、`retry later`、`too many requests`
- **断点续跑上下文保存增强** (`src/workflow/types.ts`, `NodeState`)
  - `durationMs` - 执行耗时
  - `lastErrorCategory` - 错误分类
  - `context` - 执行上下文快照（variables、inputs、lastRetryDelayMs）
- **Workflow 生成 prompt 优化** (`src/prompts/taskPrompts.ts`)
  - 添加节点设计最佳实践
  - 推荐节点数量指南（简单 2-3，中等 5-7，复杂 8-10）
  - 需要合并的节点模式
  - 常见失败模式规避
- **执行历史学习增强** (`src/agent/executionHistory.ts`)
  - 智能任务分类函数 (`categorizeTask`)
  - 节点模式提取 (`extractSuccessfulNodePatterns`)
  - 按类型推荐节点数 (`getRecommendedNodeCountByCategory`)
  - 类型特定建议 (`addCategorySpecificAdvice`)
  - 增强的历史条目（category、nodeNames、failureReasons）
- **趋势分析报告增强** (`src/report/TrendAnalyzer.ts`)
  - 任务类型维度分析 (`CategoryStats`)
  - 节点组合热力图 (`NodeCombination`)
  - 成本优化建议 (`CostOptimization`)
- **实时状态监控增强** (`src/report/LiveSummary.ts`)
  - 任务队列预览 (`QueuedTaskInfo`)
  - 预估完成时间（集成 timeEstimator）
  - 全部任务预估完成时间

### Fixed
- 修复 stats.json 保存功能（增量保存时间戳）
- 修复节点完成时自动保存 `durationMs`

### Tests
- 测试用例从 264 个增加到 366 个（+102）
- 新增约 100 个测试覆盖所有新功能
- 所有 19 个测试文件全部通过

## [0.2.2] - 2026-02-01

### Added
- **结构化错误提示系统** (`src/cli/errors.ts`) - 更友好的错误体验
  - 9 种错误类别识别（超时、网络、权限、资源、执行、配置、API、验证、未知）
  - 智能模式匹配自动识别错误类型
  - 每种错误提供具体修复建议
  - 彩色终端输出
  - 预设错误构造器：`taskNotFoundError`, `workflowGenerationError`, `nodeExecutionError`
- **趋势分析报告** (`src/report/TrendAnalyzer.ts`) - 执行趋势可视化
  - 按日/周/月分析任务执行趋势
  - 成功率趋势追踪和自动洞察生成
  - 节点性能分析（执行次数、成功率、平均耗时）
  - 成本分布分析（按日期和节点类型）
  - 多格式输出（终端、Markdown、JSON）
  - 命令：`cah report trend [--days 30] [--period week] [--markdown]`
- **实时任务摘要** (`src/report/LiveSummary.ts`) - 实时状态监控
  - 运行中任务显示（进度条、当前节点）
  - 今日统计（创建、完成、失败、耗时、成本）
  - 最近完成任务列表
  - 持续监控模式 `--watch`
  - 命令：`cah report live [--watch] [--json]`
- **任务模板系统** (`src/template/TaskTemplate.ts`) - 快速任务创建
  - 12 个内置模板（功能开发、Bug 修复、API、测试、重构、文档、DevOps、分析）
  - 变量替换支持 `{{variable}}`
  - 自定义模板创建和管理
  - 使用统计追踪
  - 命令：`cah template list/show/use/search/create`
- 新增 `errors.test.ts` 测试（14 个用例）
- 新增 `TaskTemplate.test.ts` 测试（12 个用例）
- 新增 `TrendAnalyzer.test.ts` 测试（5 个用例）
- 新增 `LiveSummary.test.ts` 测试（7 个用例）

### Changed
- **报告命令重构** (`src/cli/commands/report.ts`)
  - `cah report work` - 工作报告
  - `cah report trend` - 趋势分析报告
  - `cah report live` - 实时状态监控

## [0.2.1] - 2026-02-01

### Added
- **项目上下文感知** (`src/agent/projectContext.ts`) - Workflow 生成前自动分析项目
  - 项目类型检测（Node.js、Python、Rust、Go）
  - 语言检测（TypeScript/JavaScript、Python 等）
  - 包管理器识别（npm/pnpm/yarn/bun、poetry/pipenv/uv、cargo）
  - 框架检测（React、Vue、Express、NestJS、Vitest、Jest 等）
  - 目录结构自动生成
  - CLAUDE.md 项目规范集成
- **执行历史学习** (`src/agent/executionHistory.ts`) - 从历史任务中学习改进
  - 历史任务分析（最近 50 个任务）
  - 相似任务匹配（基于关键词）
  - 成功模式提取（成功率、平均节点数统计）
  - 失败教训总结（常见失败原因分析）
  - 节点数建议（基于历史成功经验）
- 新增 `projectContext.test.ts` 测试（3 个用例）
- 新增 `executionHistory.test.ts` 测试（6 个用例）

### Changed
- **Workflow 生成 prompt 增强** (`src/prompts/taskPrompts.ts`)
  - 新增 `{{projectContext}}` 占位符注入项目信息
  - 新增 `{{learningInsights}}` 占位符注入历史学习
- **生成流程优化** (`src/agent/generateWorkflow.ts`)
  - 生成前并行获取项目上下文和历史学习数据
  - AI 能基于项目结构生成更精准的执行计划

## [0.2.0] - 2026-02-01

### Added
- **VISION.md** - 完整的项目愿景、使命和路线图文档
- **可视化进度条** - 任务执行时显示 `[████████░░░░░░░░░░░░] 40%` 风格的进度条
- **当前节点显示** - 进度输出中显示正在执行的节点名称
- **增量统计保存** - 节点完成时自动保存执行统计到 `stats.json`（带防抖机制）
- **执行统计存储** - 新增 `ExecutionStatsStore.ts` 用于统计数据持久化
- Claude API 调用限流（最大 5 个并发）
- 工作流节点并发执行支持（最大 3 个并发节点）

### Changed
- 进度输出格式改进：从简单百分比升级为可视化进度条 + 节点名称
- 轮询间隔从 1000ms 降低到 500ms
- 流式输出改用 `stream-json` 格式
- 禁用 MCP 改用 `--strict-mcp-config`
- 移除 `index.json` 缓存，改为直接扫描任务文件夹

### Fixed
- 修复 MCP 配置导致 CLI 卡死的问题
- 修复 `--no-update-check` 选项不存在的问题
- 修复 `--output-format json` 与流式输出冲突
- 移除 `executeAgent.ts` 中未使用的导入和变量

## [0.1.1] - 2026-01-31

### Fixed
- 修复所有 lint 错误（6 → 0）
- 移除多个文件中未使用的导入和变量
  - `src/agent/executeWorkflowNode.ts`: 移除未使用的 `markNodeDone` 导入
  - `src/agent/runAgentForTask.ts`: 移除未使用的 `getOutputPath` 导入
  - `src/notify/larkServer.ts`: 移除未使用的 `getInstance` 导入和 `normalized` 变量
  - `src/output/saveWorkflowOutputToTask.ts`: 移除未使用的 `join` 导入
  - `src/task/resumeTask.ts`: 移除未使用的 `updateTask` 导入
  - `src/task/spawnTask.ts`: 移除未使用的 `getTaskFolder` 导入和 `taskDir` 变量
  - `src/workflow/queue/NodeWorker.ts`: 移除未使用的 `attempt` 变量

## [0.1.0] - 2026-01-30

### Added
- 初始版本发布
- 基于 Claude Code CLI 的任务执行系统
- Workflow 引擎支持 13 种节点类型
- 智能重试策略（指数退避、条件重试）
- 任务管理命令（create, list, logs, resume, stop）
- 文件存储系统（TaskStore, WorkflowStore）
- 事件驱动架构（WorkflowEventEmitter）
