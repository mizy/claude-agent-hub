# BUG-009: Workflow 启动后没有 Worker 处理队列

## 问题描述
当 `cah workflow start` 启动工作流后，任务被入队到 SQLite 队列中，但没有 Worker 启动来处理这些任务，导致工作流卡在 `running` 状态无法执行。

## 复现步骤
```bash
# 1. 创建 workflow
cah workflow create -f test-workflow.md

# 2. 启动 workflow
cah workflow start <id>

# 3. 检查状态 - 一直是 running，进度 0%
cah workflow status <id>

# 4. 检查队列 - 任务在队列中等待
sqlite3 .claude-agent-hub/queue.db "SELECT * FROM jobs;"
```

## 队列状态
```
5411d4bb-...:task-1:1|node:task-1|waiting|2026-01-30T13:28:18.764Z
```

## 根本原因
`cah workflow start` 只调用了 `startWorkflow()` 将任务入队，但没有：
1. 创建 NodeWorker (`createNodeWorker`)
2. 启动 Worker (`startWorker`)

Worker 相关代码存在于 `src/workflow/queue/NodeWorker.ts`，但未被 CLI 调用。

## 建议修复

### 方案 1: 在 workflow start 时自动启动 Worker

修改 `src/cli/commands/workflow.ts`:

```typescript
import { createNodeWorker, startWorker, closeWorker } from '../../workflow/index.js'
import { executeNode } from '../../workflow/engine/WorkflowEngine.js'

async function startWorkflowCommand(id: string): Promise<void> {
  // ... existing code ...

  // 创建并启动 worker
  createNodeWorker({
    processor: async (data) => {
      return await executeNode(data)
    }
  })

  await startWorker()

  // 等待完成或让用户手动停止
}
```

### 方案 2: 集成到 daemon

在 `cah start` 守护进程中同时启动 workflow worker:

```typescript
// src/scheduler/startDaemon.ts
import { createNodeWorker, startWorker } from '../workflow/index.js'

// 启动 workflow worker
createNodeWorker({
  processor: executeNodeProcessor
})
await startWorker()
```

## 优先级
**High** - Workflow 功能完全无法使用

## 状态
待修复
