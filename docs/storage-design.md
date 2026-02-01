# 统一存储架构设计

## 1. 目录结构

```
data/
├── tasks/                     # 任务存储
│   ├── index.json             # 任务索引 (缓存)
│   └── {taskId}/
│       ├── task.json          # 任务元数据
│       ├── workflow.json      # Workflow 定义
│       ├── instance.json      # Workflow 实例
│       ├── process.json       # 进程信息
│       ├── logs/
│       │   ├── execution.log
│       │   └── conversation.log
│       ├── outputs/
│       │   └── result.md
│       └── steps/
│           └── step-{n}.json
│
├── agents/                    # Agent 存储
│   └── {name}.json
│
├── meta.json                  # 全局元数据 (daemon PID 等)
└── queue.json                 # 队列数据 (预留)
```

## 2. 核心模块

### 2.1 paths.ts - 路径常量 (已有)

统一定义所有存储路径，其他模块从这里导入。

```typescript
// 基础目录
export const DATA_DIR = join(process.cwd(), 'data')
export const TASKS_DIR = join(DATA_DIR, 'tasks')
export const AGENTS_DIR = join(DATA_DIR, 'agents')

// 全局文件
export const META_FILE = join(DATA_DIR, 'meta.json')
export const TASKS_INDEX_FILE = join(TASKS_DIR, 'index.json')

// 路径生成函数
export function getTaskDir(taskId: string): string
export function getTaskFilePath(taskId: string): string
export function getWorkflowFilePath(taskId: string): string
export function getInstanceFilePath(taskId: string): string
export function getAgentFilePath(agentName: string): string
```

### 2.2 json.ts - JSON 工具 (新增)

统一 JSON 读写，支持原子写入。

```typescript
// 读取 JSON，文件不存在返回 null
export function readJson<T>(filepath: string): T | null

// 原子写入 JSON（先写 .tmp 再 rename）
export function writeJson(filepath: string, data: unknown): void

// 追加内容到文件
export function appendToFile(filepath: string, content: string): void

// 确保目录存在
export function ensureDir(dirpath: string): void
export function ensureDirs(...dirs: string[]): void
```

### 2.3 types.ts - 类型定义 (新增)

统一存储相关的类型定义。

```typescript
// 泛型 Store 接口
interface Store<T extends Entity> {
  get(id: string): T | null
  save(entity: T): void
  delete(id: string): void
  exists(id: string): boolean
  list(): T[]
}

// 带过滤的 Store 接口
interface IndexedStore<T, TFilter> extends Store<T> {
  listBy(filter: TFilter): T[]
}
```

## 3. 职责划分

| 模块 | 职责 | 数据位置 |
|------|------|----------|
| TaskStore | 任务 CRUD、索引管理、进程管理 | data/tasks/ |
| WorkflowStore | Workflow/Instance CRUD (代理到 TaskStore) | data/tasks/{taskId}/ |
| fileStore (AgentStore) | Agent CRUD、全局元数据 | data/agents/, data/meta.json |

## 4. 数据流

```
TaskStore ─────────────────────────────────────┐
    │                                          │
    ├── saveTask() ──> data/tasks/{id}/task.json
    ├── saveTaskWorkflow() ──> data/tasks/{id}/workflow.json
    ├── saveTaskInstance() ──> data/tasks/{id}/instance.json
    └── updateIndexEntry() ──> data/tasks/index.json
                                               │
WorkflowStore ─────────────────────────────────┤
    │                                          │
    ├── saveWorkflow() ──> TaskStore.saveTaskWorkflow()
    └── saveInstance() ──> TaskStore.saveTaskInstance()
                                               │
fileStore (AgentStore) ────────────────────────┘
    │
    ├── saveAgent() ──> data/agents/{name}.json
    └── setDaemonPid() ──> data/meta.json
```

## 5. 改进计划

### Phase 1: 统一工具 (当前)
- [x] 创建 `json.ts` 统一 JSON 读写
- [x] 创建 `types.ts` 定义统一接口
- [x] paths.ts 已有，继续使用

### Phase 2: 迁移各 Store (后续)
- [ ] TaskStore 使用 json.ts 的工具函数
- [ ] WorkflowStore 使用 json.ts 的工具函数
- [ ] fileStore 使用 json.ts 的工具函数
- [ ] 移除各模块重复的 readJsonSync/writeJsonSync

### Phase 3: 统一初始化 (后续)
- [ ] 创建 `src/store/index.ts` 作为统一入口
- [ ] 只在 index.ts 调用一次 ensureDirs()
- [ ] 各 Store 移除自己的初始化代码

## 6. 设计原则

1. **单一数据源**: paths.ts 是路径的唯一来源
2. **原子写入**: 所有 JSON 写入都使用原子操作
3. **目录即权威**: 任务索引只是缓存，目录内容才是真实数据
4. **职责清晰**: TaskStore 负责存储，WorkflowStore 只是薄包装
