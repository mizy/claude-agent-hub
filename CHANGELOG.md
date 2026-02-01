# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
