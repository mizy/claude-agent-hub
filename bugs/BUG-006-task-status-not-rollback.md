# BUG-006: 任务执行失败时状态未回滚

## 问题描述
当 Agent 执行任务失败时（如 `createBranch` 因工作区不干净而失败），任务状态会卡在中间状态（如 `planning`），无法被重新拾取执行。

## 复现步骤
1. 创建任务 `cah task add -t "test"`
2. 在工作区有未提交更改时启动 agent `cah start -a test-agent --foreground`
3. Agent 领取任务，状态变为 `planning`
4. `createBranch` 因工作区不干净而失败
5. 任务状态保持为 `planning`，Agent 报告 "无待处理任务"

## 问题代码位置
[runAgent.ts:37-40](src/agent/runAgent.ts#L37-L40)

```typescript
console.log(`[${agent.name}] 领取任务: ${task.title}`)
store.updateTask(task.id, {
  status: 'planning',
  assignee: agent.name
})

// 2. 创建工作分支
const branchName = `agent/${agent.name}/task-${task.id.slice(0, 8)}`
await createBranch(branchName)  // 这里失败后状态不会回滚
```

## 根本原因
`runAgent` 的 catch 块只更新了 Agent 的状态和统计，但没有将 Task 状态回滚为 `pending` 或设置为 `failed`。

## 建议修复
在 catch 块中将任务状态回滚或标记为失败：

```typescript
} catch (error) {
  console.error(`[${agent.name}] 执行出错:`, error)

  // 回滚任务状态
  if (task) {
    store.updateTask(task.id, {
      status: 'failed',  // 或者回滚到 'pending' 让其他 agent 重试
      assignee: null
    })
  }

  store.updateAgent(agent.name, {
    status: 'idle',
    stats: {
      ...agent.stats,
      tasksFailed: agent.stats.tasksFailed + 1
    }
  })
}
```

## 优先级
High - 会导致任务永久卡住

## 状态
待修复
