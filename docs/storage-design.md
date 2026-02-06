# 统一存储架构

## 1. 目录结构

数据目录默认为 `.cah-data/`，可通过以下方式覆盖:
- 环境变量 `CAH_DATA_DIR`
- CLI 参数 `-d <path>` 或 `--data-dir <path>`

```
.cah-data/
├── tasks/                     # 任务存储
│   ├── index.json             # 任务索引 (缓存)
│   └── {taskId}/
│       ├── task.json          # 任务元数据
│       ├── workflow.json      # Workflow 定义
│       ├── instance.json      # Workflow 实例(唯一执行状态源)
│       ├── stats.json         # 聚合统计(从 instance 派生)
│       ├── timeline.json      # 事件时间线(含 instanceId)
│       ├── process.json       # 后台进程信息
│       ├── logs/
│       │   ├── execution.log  # 人类可读日志
│       │   └── events.jsonl   # 机器可读事件流(JSONL)
│       └── outputs/
│           └── result.md      # 执行报告
│
├── personas/                  # Persona 存储(可选自定义)
│   └── {name}.json
│
├── meta.json                  # 全局元数据 (daemon PID 等)
└── queue.json                 # 队列数据 (预留)
```

## 2. 核心模块

### 2.1 paths.ts - 路径常量

统一定义所有存储路径，其他模块从这里导入。

```typescript
// 基础目录 (支持 CAH_DATA_DIR 环境变量和 -d 参数)
export const DATA_DIR = getDataDir()  // 默认 '.cah-data'
export const TASKS_DIR = join(DATA_DIR, 'tasks')
export const PERSONAS_DIR = join(DATA_DIR, 'personas')

// 全局文件
export const META_FILE = join(DATA_DIR, 'meta.json')
export const TASKS_INDEX_FILE = join(TASKS_DIR, 'index.json')

// 路径生成函数
export function getTaskDir(taskId: string): string
export function getTaskFilePath(taskId: string): string
export function getWorkflowFilePath(taskId: string): string
export function getInstanceFilePath(taskId: string): string
export function getStatsFilePath(taskId: string): string
export function getTimelineFilePath(taskId: string): string
export function getPersonaFilePath(name: string): string
```

### 2.2 readWriteJson.ts - JSON 工具

统一 JSON 读写，支持原子写入。

```typescript
// 读取 JSON，文件不存在返回 null
export function readJsonSync<T>(filepath: string): T | null

// 原子写入 JSON（先写 .tmp 再 rename）
export function writeJsonSync(filepath: string, data: unknown): void

// 追加内容到文件
export function appendToFile(filepath: string, content: string): void

// 确保目录存在
export function ensureDir(dirpath: string): void
export function ensureDirs(...dirs: string[]): void
```

### 2.3 types.ts - 类型定义

统一存储相关的类型定义。

```typescript
// 泛型 Store 接口
interface Store<T> {
  get(id: string): Promise<T | null> | T | null
  save(entity: T): Promise<void> | void
  delete(id: string): Promise<void> | void
  exists(id: string): Promise<boolean> | boolean
  list(filter?: FilterOptions): Promise<T[]> | T[]
}

// 过滤选项
interface FilterOptions {
  status?: string[]
  priority?: string[]
  limit?: number
  offset?: number
}
```

## 3. 职责划分

| 模块 | 职责 | 数据位置 |
|------|------|----------|
| GenericFileStore | 通用文件存储基类,提供基础 CRUD | 任意目录 |
| TaskStore | 任务 CRUD、索引管理、进程管理 | .cah-data/tasks/ |
| WorkflowStore | Workflow/Instance CRUD (代理到 TaskStore) | .cah-data/tasks/{taskId}/ |
| TaskWorkflowStore | Task 关联的 Workflow 存储 | .cah-data/tasks/{taskId}/workflow.json |
| ExecutionStatsStore | 执行统计存储(从 instance 派生) | .cah-data/tasks/{taskId}/stats.json |
| TaskLogStore | 任务日志存储(execution.log + events.jsonl) | .cah-data/tasks/{taskId}/logs/ |
| UnifiedStore | 统一存储门面,整合所有 Store | - |

## 4. 数据流

```
UnifiedStore (门面)
    │
    ├── TaskStore ────────────────────────────────────┐
    │       │                                          │
    │       ├── saveTask() ──> .cah-data/tasks/{id}/task.json
    │       ├── saveTaskWorkflow() ──> .cah-data/tasks/{id}/workflow.json
    │       ├── saveTaskInstance() ──> .cah-data/tasks/{id}/instance.json
    │       ├── saveTaskStats() ──> .cah-data/tasks/{id}/stats.json
    │       ├── saveTaskTimeline() ──> .cah-data/tasks/{id}/timeline.json
    │       └── updateIndexEntry() ──> .cah-data/tasks/index.json
    │                                                  │
    ├── WorkflowStore ────────────────────────────────┤
    │       │                                          │
    │       ├── saveWorkflow() ──> TaskStore.saveTaskWorkflow()
    │       └── saveInstance() ──> TaskStore.saveTaskInstance()
    │                                                  │
    ├── TaskWorkflowStore ────────────────────────────┤
    │       │                                          │
    │       └── save() ──> TaskStore.saveTaskWorkflow()
    │                                                  │
    ├── ExecutionStatsStore ──────────────────────────┤
    │       │                                          │
    │       └── save() ──> TaskStore.saveTaskStats()
    │                                                  │
    └── TaskLogStore ─────────────────────────────────┘
            │
            ├── appendExecutionLog() ──> .cah-data/tasks/{id}/logs/execution.log
            └── appendJsonlLog() ──> .cah-data/tasks/{id}/logs/events.jsonl
```

## 5. 实施状态

### Phase 1: 统一工具 ✅
- [x] 创建 `readWriteJson.ts` 统一 JSON 读写
- [x] 创建 `types.ts` 定义统一接口
- [x] `paths.ts` 定义路径常量

### Phase 2: 各 Store 实现 ✅
- [x] GenericFileStore 通用基类
- [x] TaskStore 任务存储
- [x] WorkflowStore Workflow 存储
- [x] TaskWorkflowStore Task 关联 Workflow
- [x] ExecutionStatsStore 执行统计
- [x] TaskLogStore 日志存储
- [x] UnifiedStore 统一门面

### Phase 3: 统一初始化 ✅
- [x] 创建 `src/store/index.ts` 作为统一入口
- [x] 所有 Store 通过 index.ts 导出

### 未来改进
- [ ] 添加缓存层(减少文件 I/O)
- [ ] 支持数据库后端(SQLite/PostgreSQL)
- [ ] 数据迁移工具
- [ ] 数据备份和恢复

## 6. 设计原则

1. **单一数据源**: paths.ts 是路径的唯一来源
2. **原子写入**: 所有 JSON 写入都使用原子操作
3. **目录即权威**: 任务索引只是缓存，目录内容才是真实数据
4. **职责清晰**: TaskStore 负责存储，WorkflowStore 只是薄包装
