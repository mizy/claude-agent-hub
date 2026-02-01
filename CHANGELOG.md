# Changelog

## Unreleased

### Added
- Claude API 调用限流（最大 5 个并发）
- 工作流节点并发执行支持（最大 3 个并发节点）

### Changed
- 轮询间隔从 1000ms 降低到 500ms
- 流式输出改用 `stream-json` 格式
- 禁用 MCP 改用 `--strict-mcp-config`
- 移除 `index.json` 缓存，改为直接扫描任务文件夹（更简单、无同步问题）

### Fixed
- 修复 MCP 配置导致 CLI 卡死的问题
- 修复 `--no-update-check` 选项不存在的问题
- 修复 `--output-format json` 与流式输出冲突

## Iteration 1 - 2026-01-31

### Changes
- 修复所有 lint 错误（6 → 0）
- 移除多个文件中未使用的导入和变量

### Technical Details
- `src/agent/executeWorkflowNode.ts`: 移除未使用的 `markNodeDone` 导入
- `src/agent/runAgentForTask.ts`: 移除未使用的 `getOutputPath` 导入
- `src/notify/larkServer.ts`: 移除未使用的 `getInstance` 导入和 `normalized` 变量
- `src/output/saveWorkflowOutputToTask.ts`: 移除未使用的 `join` 导入
- `src/task/resumeTask.ts`: 移除未使用的 `updateTask` 导入
- `src/task/spawnTask.ts`: 移除未使用的 `getTaskFolder` 导入和 `taskDir` 变量
- `src/workflow/queue/NodeWorker.ts`: 移除未使用的 `attempt` 变量
- 验收结果：类型检查、lint、构建、测试全部通过
