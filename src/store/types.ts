/**
 * 统一存储类型定义
 *
 * 定义所有存储相关的接口和类型。
 */

// ============ 泛型存储接口 ============

/**
 * 基础实体接口 - 所有可存储实体都需实现
 */
export interface Entity {
  id: string
}

/**
 * 泛型 Store 接口
 *
 * @example
 * ```ts
 * const taskStore: Store<Task> = createStore(...)
 * await taskStore.get('task-123')
 * await taskStore.list({ status: 'running' })
 * ```
 */
export interface Store<T extends Entity> {
  /** 获取单个实体 */
  get(id: string): T | null

  /** 保存实体 (创建或更新) */
  save(entity: T): void

  /** 删除实体 */
  delete(id: string): void

  /** 检查实体是否存在 */
  exists(id: string): boolean

  /** 列出所有实体 */
  list(): T[]
}

/**
 * 带索引的 Store 接口
 * 支持按条件过滤列表
 */
export interface IndexedStore<
  T extends Entity,
  TFilter = Record<string, unknown>,
> extends Store<T> {
  /** 按条件过滤列表 */
  listBy(filter: TFilter): T[]
}

// ============ JSON 读写工具类型 ============

/**
 * JSON 读取选项
 */
export interface JsonReadOptions {
  /** 文件不存在时返回的默认值 */
  defaultValue?: unknown
  /** 运行时校验函数，返回 false 时视为无效数据 */
  validate?: (data: unknown) => boolean
}

/**
 * JSON 写入选项
 */
export interface JsonWriteOptions {
  /** 是否使用原子写入 (先写临时文件再 rename) */
  atomic?: boolean
  /** JSON 缩进空格数，默认 2 */
  indent?: number
}

// ============ 存储路径类型 ============

/**
 * 任务文件类型
 */
export type TaskFileType =
  | 'task' // task.json
  | 'workflow' // workflow.json
  | 'instance' // instance.json
  | 'process' // process.json

/**
 * 任务日志类型
 */
export type TaskLogType =
  | 'execution' // logs/execution.log
  | 'conversation' // logs/conversation.log

/**
 * 任务输出类型
 */
export type TaskOutputType = 'result' // outputs/result.md

// ============ 存储事件类型 ============

/**
 * 存储操作类型
 */
export type StoreOperation = 'create' | 'update' | 'delete'

/**
 * 存储事件
 */
export interface StoreEvent<T extends Entity> {
  operation: StoreOperation
  entityType: string
  entityId: string
  entity?: T
  timestamp: string
}

/**
 * 存储事件监听器
 */
export type StoreEventListener<T extends Entity> = (event: StoreEvent<T>) => void

// ============ 元数据类型 ============

/**
 * 全局元数据
 */
export interface GlobalMeta {
  /** 守护进程 PID */
  daemonPid?: number
  /** 最后更新时间 */
  updatedAt?: string
}

// ============ 索引类型 ============

/**
 * 任务索引项
 */
export interface TaskIndexEntry {
  id: string
  title: string
  status: string
  priority: string
  createdAt: string
  updatedAt?: string
}

/**
 * 任务索引
 */
export interface TaskIndex {
  tasks: TaskIndexEntry[]
  updatedAt: string
}
