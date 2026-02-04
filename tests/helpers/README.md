# 测试辅助工具

本目录提供完整的测试基础设施，用于编写高质量的单元测试和集成测试。

## 文件结构

```
tests/helpers/
├── index.ts                    # 统一导出入口
├── test-data.ts                # 通用测试数据工厂
├── workflow-test-data.ts       # Workflow 测试数据工厂
├── test-env.ts                 # 测试环境管理
├── test-assertions.ts          # 测试断言工具
├── concurrency.ts              # 并发测试工具
├── init-medium-test-env.ts     # Medium 优先级测试环境初始化
└── README.md                   # 本文档
```

## 快速开始

### 1. 导入测试辅助工具

```typescript
import {
  // 测试环境
  TestEnvironment,
  setupTestEnv,
  cleanupTestEnv,

  // Workflow 数据工厂
  createLinearWorkflow,
  createConditionalWorkflow,
  createLoopWorkflow,
  createRetryWorkflow,
  createWorkflowInstance,
  createNodeJobData,

  // 测试断言
  assertWorkflowExists,
  assertNodeStatus,
  assertAllNodesCompleted,

  // 测试场景
  retryErrorScenarios,
  lifecycleScenarios,
} from '../helpers/index.js'
```

### 2. 编写测试

```typescript
import { describe, it, beforeEach, afterEach } from 'vitest'
import { TestEnvironment, setupTestEnv, cleanupTestEnv } from '../helpers/index.js'

describe('Workflow Execution', () => {
  let env: TestEnvironment

  beforeEach(async () => {
    env = await setupTestEnv()
  })

  afterEach(async () => {
    await cleanupTestEnv(env)
  })

  it('should execute linear workflow', async () => {
    // 创建测试数据
    const workflow = createLinearWorkflow('test-task-1')
    const task = {
      id: 'test-task-1',
      title: '测试任务',
      status: 'pending' as const,
      // ...
    }

    // 保存数据
    await env.createTask(task)
    await env.createWorkflow(task.id, workflow)

    // 执行测试逻辑...

    // 断言
    const loadedWorkflow = await env.getWorkflow(task.id)
    assertWorkflowExists(loadedWorkflow, task.id)
  })
})
```

## 核心功能

### 测试环境管理 (test-env.ts)

**TestEnvironment** - 提供隔离的测试环境

- `setup()` - 初始化测试环境
- `cleanup()` - 清理测试环境
- `createTask(task)` - 创建测试任务
- `createWorkflow(taskId, workflow)` - 创建 Workflow
- `createInstance(taskId, instance)` - 创建 Instance
- `getTask(taskId)` - 获取任务
- `getWorkflow(taskId)` - 获取 Workflow
- `getInstance(taskId)` - 获取 Instance
- `getDataDir()` - 获取数据目录
- `fileExists(path)` - 检查文件是否存在

**快速创建/清理函数**

```typescript
const env = await setupTestEnv()  // 创建并初始化
await cleanupTestEnv(env)          // 清理环境
```

**测试钩子**

```typescript
const hooks = createTestHooks()

beforeEach(async () => {
  return await hooks.beforeEach()
})

afterEach(async () => {
  await hooks.afterEach()
})
```

### Workflow 测试数据工厂 (workflow-test-data.ts)

**Workflow 场景**

- `createLinearWorkflow()` - 简单线性工作流（start → task1 → task2 → end）
- `createConditionalWorkflow()` - 条件分支工作流（包含 condition 节点）
- `createLoopWorkflow()` - 循环工作流（包含 loop 节点）
- `createRetryWorkflow()` - 重试测试工作流（配置重试策略）

**节点创建**

- `createTaskNode(id, name, persona)` - 创建任务节点
- `createConditionNode(id, name, expression)` - 创建条件节点
- `createLoopNode(id, name, maxIterations)` - 创建循环节点

**Instance 创建**

```typescript
const instance = createWorkflowInstance(
  workflowId,
  ['start', 'task-1', 'task-2', 'end'],
  {
    allPending: true,           // 所有节点待处理
    allCompleted: false,        // 所有节点已完成
    currentNodeId: 'task-1',    // 当前执行节点
  }
)
```

**测试场景**

```typescript
// 重试错误场景（7个场景）
retryErrorScenarios.forEach(scenario => {
  it(`should handle: ${scenario.name}`, () => {
    const error = createMockError(scenario)
    // 测试错误分类和重试逻辑
  })
})

// 生命周期场景（6个场景）
lifecycleScenarios.forEach(scenario => {
  it(`should ${scenario.action} task from ${scenario.initialStatus}`, () => {
    const task = createTaskWithStatus(scenario.initialStatus)
    // 测试生命周期转换
  })
})
```

### 测试断言 (test-assertions.ts)

**任务和 Workflow 断言**

- `assertTaskExists(task, taskId)` - 断言任务存在
- `assertTaskStatus(task, expectedStatus)` - 断言任务状态
- `assertWorkflowExists(workflow, taskId)` - 断言 Workflow 存在
- `assertInstanceExists(instance, taskId)` - 断言 Instance 存在
- `assertWorkflowHasNode(workflow, nodeId, nodeType?)` - 断言包含节点
- `assertWorkflowEdge(workflow, from, to)` - 断言边连接

**节点状态断言**

- `assertNodeStatus(instance, nodeId, expectedStatus)` - 断言节点状态
- `assertAllNodesCompleted(instance)` - 断言所有节点已完成
- `assertNodeExecutionOrder(instance, expectedOrder)` - 断言执行顺序
- `assertNodeOutput(instance, nodeId, expectedKeys?)` - 断言节点输出

**重试断言**

- `assertRetryAttempts(instance, nodeId, expectedAttempts)` - 断言重试次数
- `assertRetryAttemptsInRange(instance, nodeId, min, max)` - 断言重试次数范围

**统计和性能断言**

- `assertExecutionStats(summary, expectations)` - 断言执行统计
- `assertPerformance(actualMs, expectedMs, tolerance)` - 断言性能指标

**通用断言**

- `assertArrayUnique(array, itemName)` - 断言数组唯一
- `assertArrayNotEmpty(array, arrayName)` - 断言数组非空
- `assertObjectHasKeys(obj, keys, objectName)` - 断言对象包含键
- `assertErrorMatches(error, pattern)` - 断言错误消息匹配
- `assertTimeInRange(timestamp, minTime, maxTime)` - 断言时间范围

### 并发测试工具 (concurrency.ts)

**并发执行**

```typescript
const results = await runConcurrent(5, async (index) => {
  // 并发执行的操作
  return await someAsyncOperation(index)
})

// 分析结果
const stats = analyzeConcurrencyResults(results, durations)
console.log(`成功率: ${stats.successRate * 100}%`)
console.log(`P95 延迟: ${stats.p95Duration}ms`)
```

**性能计时**

```typescript
const timer = new PerfTimer()

timer.mark('start')
await operation1()

timer.mark('operation1-done')
await operation2()

console.log('总耗时:', timer.elapsed(), 'ms')
console.log('Operation 1 耗时:', timer.elapsed('start'), 'ms')
```

**测试数据目录管理**

```typescript
const testDir = new TestDataDir('my-test')
const path = testDir.setup()

// 执行测试...

testDir.cleanup()
```

## 测试场景数据

### 重试错误场景 (7个)

1. 暂时性错误 - 超时 (transient, 应重试)
2. 暂时性错误 - 网络重置 (transient, 应重试)
3. 暂时性错误 - API 限流 (transient, 应重试)
4. 可恢复错误 - 服务不可用 (recoverable, 应重试)
5. 永久性错误 - 认证失败 (permanent, 不重试)
6. 永久性错误 - 资源不存在 (permanent, 不重试)
7. 未知错误 (unknown, 默认重试)

### 生命周期场景 (6个)

1. 启动待处理任务 (pending → running)
2. 暂停运行中任务 (running → paused)
3. 恢复暂停任务 (paused → running)
4. 完成运行中任务 (running → completed)
5. 取消运行中任务 (running → cancelled)
6. 尝试启动已完成任务 (completed → completed, 应失败)

## 最佳实践

### 1. 使用隔离的测试环境

每个测试应该有独立的数据目录：

```typescript
beforeEach(async () => {
  env = await setupTestEnv({
    dataDir: `/tmp/cah-test-${Date.now()}`,
    cleanupOnExit: true,
  })
})
```

### 2. 使用工厂函数创建测试数据

避免手动构造复杂的测试数据：

```typescript
// ✅ 好
const workflow = createLinearWorkflow('task-1')

// ❌ 不好
const workflow = {
  id: 'workflow-1',
  taskId: 'task-1',
  nodes: [
    { id: 'start', type: 'start', name: '开始' },
    // ... 大量重复代码
  ],
  // ...
}
```

### 3. 使用断言工具

使用专门的断言函数提高可读性：

```typescript
// ✅ 好
assertNodeStatus(instance, 'task-1', 'completed')

// ❌ 不好
expect(instance.nodeStates['task-1'].status).toBe('completed')
```

### 4. 复用测试场景

利用预定义的测试场景：

```typescript
retryErrorScenarios.forEach(scenario => {
  it(`should handle: ${scenario.name}`, async () => {
    const error = createMockError(scenario)
    const classified = classifyError(error)

    expect(classified.category).toBe(scenario.expectedCategory)
    expect(classified.retryable).toBe(scenario.shouldRetry)
  })
})
```

### 5. 清理测试环境

始终在测试后清理：

```typescript
afterEach(async () => {
  if (env) {
    await cleanupTestEnv(env)
  }
})
```

## 验证

运行验证脚本确保测试辅助工具正常工作：

```bash
npx tsx tests/helpers/verify-test-helpers.ts
```

输出示例：

```
🔍 验证测试辅助工具...

1️⃣ 测试 Workflow 数据工厂
  ✓ 线性工作流: 4 个节点
  ✓ 条件分支工作流: 6 个节点
  ✓ 循环工作流: 4 个节点
  ✓ 重试工作流: 3 个节点

...

✅ 所有测试辅助工具验证通过！
```

## 下一步

根据前一个节点的分析结果，建议优先编写以下测试：

### 高优先级测试

1. **Workflow 节点执行器** (executeNode.ts)
   - 使用 `createLinearWorkflow()` 测试简单执行流程
   - 使用 `createRetryWorkflow()` 测试重试逻辑
   - 使用 `retryErrorScenarios` 测试错误处理

2. **重试策略机制** (RetryStrategy.ts)
   - 使用 `retryErrorScenarios` 测试错误分类
   - 使用 `createMockError()` 创建测试错误
   - 使用 `assertRetryAttempts()` 验证重试次数

3. **任务执行生命周期** (manageTaskLifecycle.ts)
   - 使用 `lifecycleScenarios` 测试状态转换
   - 使用 `createTaskWithStatus()` 创建不同状态的任务
   - 使用 `assertTaskStatus()` 验证状态变化

### 中优先级测试

- WorkflowStore 持久化
- 项目上下文分析
- 模板系统

### 低优先级测试

- 报告生成
- 端到端集成测试
