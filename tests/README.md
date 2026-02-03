# 并发测试环境说明

## 目录结构

```
tests/
├── README.md                      # 本文件
├── concurrency.test.ts            # 并发测试主文件
├── helpers/
│   └── concurrency.ts             # 并发测试辅助工具
└── ... (其他测试文件)
```

## 环境准备

### 1. 依赖安装

确保已安装所有依赖（测试框架和工具）：

```bash
npm install
```

当前使用的测试依赖：
- **vitest@2.1.9**: 测试框架
- **execa@9.3.0**: 多进程执行工具（已在生产依赖中）

### 2. 构建项目

并发测试需要运行实际的 CLI 命令，因此需要先构建：

```bash
npm run build
```

### 3. 配置测试数据目录

测试会使用临时目录，避免污染真实数据：

```bash
# 方式1: 使用环境变量（推荐）
export CAH_DATA_DIR=/tmp/cah-test-data

# 方式2: 测试会自动创建临时目录
# 默认格式: /tmp/cah-test-{name}-{timestamp}
```

## 运行测试

### 运行所有并发测试

```bash
npm test concurrency
```

### 运行特定测试

```bash
# 运行队列测试
npm test -- -t "队列操作"

# 运行锁机制测试
npm test -- -t "文件锁"

# 运行性能测试
npm test -- -t "性能指标"
```

### 开发模式（实时监听）

```bash
npm run test:watch -- concurrency
```

## 测试模块说明

### 1. 辅助工具 (helpers/concurrency.ts)

提供并发测试的基础设施：

| 工具 | 作用 |
|------|------|
| **TestDataDir** | 管理测试数据目录（自动创建/清理） |
| **runConcurrent** | 并发执行多个异步函数 |
| **runCLIConcurrent** | 并发执行多个 CLI 命令 |
| **createStaleLock** | 创建过期锁文件（用于死锁恢复测试） |
| **PerfTimer** | 性能计时器 |
| **analyzeConcurrencyResults** | 统计并发测试结果 |
| **waitFor** | 等待条件满足（异步轮询） |
| **sleep** | 延迟辅助函数 |

### 2. 测试套件 (concurrency.test.ts)

包含以下测试场景：

#### A. 队列并发操作测试
- 内存队列并发入队/出队
- 优先级排序验证
- 文件队列多进程并发操作

#### B. 文件锁机制测试
- 锁竞争和重试
- 死锁恢复（30秒超时）
- 锁失败率统计

#### C. 任务生命周期测试
- 并发任务创建（ID 唯一性）
- 并发状态更新（一致性）
- 并发删除操作

#### D. 性能指标测试
- 入队延迟（P95 < 100ms）
- 吞吐量（> 50 ops/s）
- 锁获取成功率（> 95%）

#### E. 端到端测试
- 5个并发任务完整执行
- 混合优先级任务调度

## 测试策略

### 单元测试

针对单个模块的功能验证：

```typescript
// 示例：测试内存队列的优先级排序
it('应按优先级正确出队', () => {
  const queue = createQueue()

  queue.enqueue('task-1', { name: 'low-1' }, 'low')
  queue.enqueue('task-2', { name: 'high-1' }, 'high')

  expect(queue.dequeue()?.data.name).toBe('high-1')
  expect(queue.dequeue()?.data.name).toBe('low-1')
})
```

### 集成测试

跨模块的交互验证：

```typescript
// 示例：多进程并发入队
it('应处理多进程并发入队', async () => {
  const results = await runCLIConcurrent(5, ['test task'], {
    CAH_DATA_DIR: testDataDir.getPath()
  })

  const stats = await getQueueStats()
  expect(stats.waiting).toBe(5)
})
```

### 压力测试

高负载场景验证：

```typescript
// 示例：批量任务创建
it('应处理批量任务创建', async () => {
  const timer = new PerfTimer()

  const tasks = Array(100).fill(null).map((_, i) => ({
    description: `Task ${i}`
  }))

  await Promise.all(tasks.map(createTask))

  const elapsed = timer.elapsed()
  expect(elapsed).toBeLessThan(5000) // 5秒内完成
})
```

## 关键测试场景

### 场景 1: 并发任务创建

**背景**: 模拟用户同时创建5个任务（符合"并发测试任务 5"）

**验证点**:
- 所有任务都创建成功
- 任务 ID 唯一无冲突
- 任务文件夹正确创建

### 场景 2: 队列锁竞争

**背景**: 10个进程同时尝试获取队列锁

**验证点**:
- 锁获取重试机制正常（最多10次，每次延迟100ms）
- 最终所有进程都能完成操作或正确失败
- 队列文件完整性（无数据损坏）

### 场景 3: 死锁恢复

**背景**: 模拟进程崩溃后留下过期锁文件（30秒前）

**验证点**:
- 新进程能检测到过期锁
- 自动清理旧锁并获取新锁
- 操作成功完成

### 场景 4: 优先级调度

**背景**: 混合优先级任务同时入队

**验证点**:
- 出队顺序：high > medium > low
- 同优先级按创建时间排序
- 并发情况下排序不乱

### 场景 5: 批量操作原子性

**背景**: 使用 enqueueNodes 批量入队5个节点

**验证点**:
- 要么全部成功，要么全部失败（原子性）
- 队列状态一致
- 返回的 jobId 数量正确

## 性能基准

| 指标 | 目标值 | 测试方法 |
|------|--------|----------|
| 入队延迟 (P95) | < 100ms | 统计50次操作的95分位 |
| 吞吐量 | > 50 ops/s | 1秒内尝试最多入队操作 |
| 锁获取成功率 | > 95% | 统计10次并发锁竞争 |
| 任务丢失率 | 0% | 验证入队数 = 队列任务数 |
| 优先级准确率 | 100% | 验证出队顺序完全符合规则 |

## 已知问题和限制

### 文件锁机制

**问题**: 基于 `wx` 模式的文件锁在 NFS 等分布式文件系统上不可靠

**影响**: 测试在本地文件系统上正常，但在网络文件系统可能失败

**缓解**: 测试时确保使用本地文件系统（如 `/tmp`）

### 锁超时时间

**问题**: 30秒超时时间硬编码在 `WorkflowQueue.ts:50`

**影响**: 高负载下可能误判为死锁

**缓解**: 测试中避免长时间持锁操作

### 内存队列持久化

**问题**: `createQueue()` 返回的内存队列无持久化

**影响**: 进程崩溃会丢失数据

**缓解**: 测试中使用 `WorkflowQueue`（文件队列）进行并发测试

## 调试技巧

### 查看测试日志

```bash
# 开启详细日志
CAH_LOG_LEVEL=debug npm test concurrency
```

### 保留测试数据

```bash
# 修改 afterEach 中的 cleanup 逻辑，注释掉清理代码
# tests/concurrency.test.ts
afterEach(() => {
  // testDataDir.cleanup() // 注释掉，保留数据
})
```

### 单独测试某个场景

```bash
# 使用 .only 聚焦测试
it.only('应处理并发入队操作', async () => {
  // ...
})
```

### 增加超时时间

```bash
# 对于长时间运行的测试
it('长时间压力测试', async () => {
  // ...
}, 60000) // 60秒超时
```

## 下一步

1. 实现所有 `.todo()` 测试用例
2. 运行测试并收集性能数据
3. 根据测试结果修复问题或优化代码
4. 生成测试报告

## 参考

- 测试计划: `.cah-data/tasks/task-20260202-175049-d41/outputs/test-plan.md`
- 队列实现: `src/scheduler/createQueue.ts`, `src/workflow/queue/WorkflowQueue.ts`
- 任务管理: `src/task/manageTaskLifecycle.ts`
