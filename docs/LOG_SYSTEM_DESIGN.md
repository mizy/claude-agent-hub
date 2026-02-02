# 统一日志系统设计方案

## 一、设计目标

1. **统一输出格式**：消除 260+ 处分散的 console.log 调用
2. **分离关注点**：用户输出 vs 诊断日志 vs 文件日志
3. **增强错误诊断**：丰富错误上下文信息
4. **保持简洁**：不过度设计，最小化改动

## 二、日志分级策略

| 级别 | 用途 | 输出目标 |
|------|------|----------|
| DEBUG | 详细调试信息 | 仅开发模式终端 + 文件 |
| INFO | 关键流程信息 | 终端 + 文件 |
| WARN | 警告信息 | 终端 + 文件 |
| ERROR | 错误信息 | 终端 + 文件 |

级别控制：
- 开发模式 (DEBUG=1)：显示 DEBUG 及以上
- 生产模式：显示 INFO 及以上
- 静默模式 (SILENT=1)：仅 ERROR

## 三、输出模式设计

### 1. 用户输出 (cli/output.ts)

面向终端用户的友好输出，**无时间戳，简洁美观**：

```typescript
// 扩展后的 API
import { ui } from './cli/output'

ui.success('任务创建成功')           // ✓ 任务创建成功
ui.error('任务不存在')               // ✗ 任务不存在
ui.warn('配置文件未找到')            // ! 配置文件未找到
ui.info('正在分析项目...')           // ℹ 正在分析项目...

// 新增：列表和表格输出
ui.list([                            // 带编号或缩进的列表
  { label: 'ID', value: 'task-123' },
  { label: '标题', value: '优化日志' },
])

ui.header('任务详情')                 // === 任务详情 ===
ui.divider()                          // ────────────────
ui.blank()                            // 空行

// 新增：进度类输出
ui.step(1, 5, '分析代码')             // [1/5] 分析代码
ui.progress('执行中', 3, 10)          // 执行中 [███░░░░░░░] 30%
```

### 2. 诊断日志 (shared/logger.ts)

面向开发者的结构化日志，**带时间戳和 scope**：

```typescript
// 现有 API 保持不变
import { createLogger } from './shared/logger'

const logger = createLogger('workflow')

logger.debug('Loading workflow', { id: 'wf-123' })
logger.info('Node started', { nodeId: 'n1' })
logger.warn('Retry attempt', { attempt: 2 })
logger.error('Node failed', { nodeId: 'n1', error: 'timeout' })
```

终端输出格式：
```
16:40:23 DBG [workflow] Loading workflow { id: 'wf-123' }
16:40:24 INF [workflow] Node started { nodeId: 'n1' }
```

### 3. 文件日志 (store/TaskLogStore.ts)

持久化到文件的结构化日志：

**execution.log** - 人类可读：
```
2026-02-02T16:40:23.456Z INF [lifecycle] Task started
2026-02-02T16:40:24.789Z INF [node] Node analyze started
2026-02-02T16:40:30.123Z ERR [node] Node analyze failed: timeout
```

**events.jsonl** - 机器可读：
```json
{"timestamp":"2026-02-02T16:40:23.456Z","event":"task_started","taskId":"task-123"}
{"timestamp":"2026-02-02T16:40:24.789Z","event":"node_started","taskId":"task-123","nodeId":"n1"}
```

## 四、Logger API 设计

### 4.1 扩展 cli/output.ts

```typescript
/**
 * CLI 用户输出工具
 * 用于面向用户的终端输出，简洁友好
 */
import chalk from 'chalk'

// 基础输出 (现有)
export function success(message: string): void
export function error(message: string): void
export function warn(message: string): void
export function info(message: string): void

// 结构化输出 (新增)
export function header(title: string): void
export function divider(): void
export function blank(): void

// 列表输出 (新增)
export interface ListItem {
  label: string
  value: string | number
  dim?: boolean  // 是否使用暗色
}
export function list(items: ListItem[], indent?: number): void

// 进度输出 (新增)
export function step(current: number, total: number, message: string): void
export function progress(label: string, current: number, total: number): void

// 命名空间导出，便于使用
export const ui = {
  success, error, warn, info,
  header, divider, blank,
  list, step, progress,
}
```

### 4.2 增强 shared/logger.ts

```typescript
// 现有 API 保持不变
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

// 新增：支持结构化数据
export function createLogger(scope: string): Logger

// 新增：错误日志增强
export interface ErrorContext {
  taskId?: string
  nodeId?: string
  nodeName?: string
  instanceId?: string
  attempt?: number
  input?: unknown
  stack?: string
}

export function logError(
  logger: Logger,
  message: string,
  error: Error | string,
  context?: ErrorContext
): void
```

## 五、各场景日志使用规范

### 5.1 CLI 命令输出

```typescript
// cli/commands/task.ts

import { ui } from '../output'

// ✓ 正确：使用 ui 工具
async function showTask(id: string) {
  const task = await getTask(id)
  if (!task) {
    ui.error(`任务不存在: ${id}`)
    return
  }

  ui.header('任务详情')
  ui.list([
    { label: 'ID', value: task.id },
    { label: '标题', value: task.title },
    { label: '状态', value: task.status },
  ])
}

// ✗ 错误：直接使用 console.log
async function showTaskBad(id: string) {
  console.log(chalk.cyan('任务详情'))
  console.log(`  ID: ${id}`)
}
```

### 5.2 任务执行日志

```typescript
// task/executeTask.ts

import { createLogger, logError } from '../shared/logger'
import { ui } from '../cli/output'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore'

const logger = createLogger('task-executor')

async function executeTask(task: Task, options: { foreground: boolean }) {
  const { foreground } = options

  // 用户输出（仅前台模式）
  if (foreground) {
    ui.info(`开始执行任务: ${task.title}`)
  }

  // 诊断日志（始终记录）
  logger.info('Task execution started', { taskId: task.id })

  // 文件日志
  appendExecutionLog(task.id, 'Task execution started', { scope: 'lifecycle' })
  appendJsonlLog(task.id, { event: 'task_started' })

  try {
    // ... 执行逻辑
  } catch (err) {
    // 增强的错误日志
    logError(logger, 'Task execution failed', err, {
      taskId: task.id,
      nodeId: currentNode?.id,
    })

    if (foreground) {
      ui.error(`任务执行失败: ${err.message}`)
    }
  }
}
```

### 5.3 节点执行日志

```typescript
// workflow/executeNode.ts

import { createLogger, logError, type ErrorContext } from '../shared/logger'
import { appendExecutionLog, appendJsonlLog } from '../store/TaskLogStore'

const logger = createLogger('node-executor')

async function executeNode(node: Node, context: ExecutionContext) {
  const errorContext: ErrorContext = {
    taskId: context.taskId,
    nodeId: node.id,
    nodeName: node.name,
    instanceId: context.instanceId,
  }

  logger.info('Node started', { nodeId: node.id, nodeName: node.name })

  try {
    const result = await runNode(node, context)
    logger.info('Node completed', { nodeId: node.id, durationMs: result.duration })
    return result
  } catch (err) {
    // 完整的错误上下文
    logError(logger, 'Node execution failed', err, {
      ...errorContext,
      input: node.task,  // 记录输入便于复现
      attempt: context.retryCount,
    })
    throw err
  }
}
```

### 5.4 后台守护进程

```typescript
// scheduler/startDaemon.ts

import { createLogger } from '../shared/logger'

const logger = createLogger('daemon')

// ✓ 正确：使用 logger
function startDaemon() {
  logger.info('Daemon started', { pid: process.pid })

  setInterval(() => {
    logger.debug('Polling for tasks')
    // ...
  }, 5000)
}

// ✗ 错误：直接 console.log
function startDaemonBad() {
  console.log(chalk.green('启动守护进程...'))
}
```

## 六、迁移计划

### Phase 1: 扩展工具函数 (本次)

1. 扩展 `cli/output.ts`，增加 `header/divider/list/step/progress`
2. 增强 `shared/logger.ts`，增加 `logError` 辅助函数
3. 导出 `ui` 命名空间便于使用

### Phase 2: 核心文件迁移 (后续节点)

按优先级迁移以下文件：

**高优先级**（用户直接交互）：
- `src/cli/index.ts` - 17 处
- `src/cli/commands/task.ts` - 40+ 处
- `src/cli/commands/template.ts` - 50+ 处
- `src/task/queryTask.ts` - 30+ 处

**中优先级**（执行流程）：
- `src/task/createTask.ts` - 5 处
- `src/task/executeTask.ts` - 双模式输出
- `src/workflow/executeNode.ts` - 错误上下文

**低优先级**（后台/配置）：
- `src/scheduler/startDaemon.ts` - 10 处
- `src/config/initProject.ts` - 8 处
- `src/persona/loadPersona.ts` - 1 处

### Phase 3: 日志合并优化 (可选)

1. 流式输出分离：Claude 原始输出写入单独文件 `stream.log`
2. 减少重复记录：统一事件源，其他位置引用

## 七、关键实现细节

### 7.1 环境变量控制

```bash
# 日志级别
LOG_LEVEL=debug|info|warn|error|silent

# 快捷变量
DEBUG=1          # 等同于 LOG_LEVEL=debug
SILENT=1         # 等同于 LOG_LEVEL=silent
NO_COLOR=1       # 禁用颜色输出
```

### 7.2 前台/后台模式判断

```typescript
// 判断是否前台模式
const isForeground = process.stdout.isTTY && !process.env.CAH_BACKGROUND

// 前台：用户输出 + 诊断日志
// 后台：仅诊断日志 + 文件日志
```

### 7.3 进度日志聚合

避免大量进度日志刷屏：

```typescript
// 使用单行更新（仅前台）
if (isForeground && process.stdout.isTTY) {
  process.stdout.write(`\r执行中 [${progressBar}] ${percent}%`)
}

// 文件日志：仅记录开始/结束/关键节点
```

## 八、总结

| 场景 | 工具 | 格式 |
|------|------|------|
| 终端用户交互 | `ui.*` | 简洁友好，无时间戳 |
| 开发调试 | `logger.*` | 结构化，带时间戳和 scope |
| 持久化诊断 | `appendExecutionLog` | ISO 时间戳，人类可读 |
| 分析处理 | `appendJsonlLog` | JSON Lines，机器可读 |

核心原则：
1. **用户看 ui，开发看 logger，分析看文件**
2. **错误必带上下文**
3. **最小化改动，渐进迁移**
