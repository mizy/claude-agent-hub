/**
 * 泛型文件存储类
 *
 * 基于文件系统的 JSON 存储实现，支持两种存储模式：
 * 1. 文件模式（默认）：每个实体一个 JSON 文件
 * 2. 目录模式：每个实体一个目录，数据存在目录内的指定文件中
 *
 * 支持可选的 Summary 转换和简单查询过滤。
 */

import { existsSync, readdirSync, unlinkSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { readJson, writeJson, ensureDir } from './readWriteJson.js'

/**
 * 存储模式
 */
export type StoreMode = 'file' | 'directory'

/**
 * 文件存储配置
 */
export interface FileStoreOptions<T, S = T> {
  /** 存储目录 */
  dir: string
  /** 存储模式：file（每个实体一个文件）或 directory（每个实体一个目录） */
  mode?: StoreMode
  /** 文件扩展名，默认 .json（仅文件模式有效） */
  ext?: string
  /** 目录内的数据文件名，默认 data.json（仅目录模式有效） */
  dataFile?: string
  /** 可选：将完整实体转为摘要（用于列表显示） */
  toSummary?: (item: T) => S
  /** 可选：支持部分 ID 匹配 */
  partialIdMatch?: boolean
}

/**
 * 查询过滤条件类型
 */
export type QueryFilter<T> = Partial<T> | ((item: T) => boolean)

/**
 * 泛型文件存储类
 *
 * @example
 * ```ts
 * // 文件模式（默认）
 * interface User { id: string; name: string; status: string }
 * interface UserSummary { id: string; name: string }
 *
 * const store = new FileStore<User, UserSummary>({
 *   dir: 'data/users',
 *   toSummary: (u) => ({ id: u.id, name: u.name })
 * })
 *
 * // 目录模式
 * const taskStore = new FileStore<Task, TaskSummary>({
 *   dir: 'data/tasks',
 *   mode: 'directory',
 *   dataFile: 'task.json',
 *   partialIdMatch: true,
 *   toSummary: (t) => ({ id: t.id, title: t.title })
 * })
 * ```
 */
export class FileStore<T, S = T> {
  private dir: string
  private mode: StoreMode
  private ext: string
  private dataFile: string
  private toSummary?: (item: T) => S
  private partialIdMatch: boolean

  constructor(options: FileStoreOptions<T, S>) {
    this.dir = options.dir
    this.mode = options.mode ?? 'file'
    this.ext = options.ext ?? '.json'
    this.dataFile = options.dataFile ?? 'data.json'
    this.toSummary = options.toSummary
    this.partialIdMatch = options.partialIdMatch ?? false
    ensureDir(this.dir)
  }

  /** 获取存储目录 */
  getDir(): string {
    return this.dir
  }

  /** 获取实体的路径（文件模式返回文件路径，目录模式返回目录路径） */
  getEntityPath(id: string): string {
    if (this.mode === 'directory') {
      return join(this.dir, id)
    }
    return join(this.dir, `${id}${this.ext}`)
  }

  /** 获取数据文件路径 */
  private getDataPath(id: string): string {
    if (this.mode === 'directory') {
      return join(this.dir, id, this.dataFile)
    }
    return join(this.dir, `${id}${this.ext}`)
  }

  /** 从文件/目录名提取 ID */
  private getIdFromEntry(entry: string): string {
    if (this.mode === 'directory') {
      return entry
    }
    return basename(entry, this.ext)
  }

  /** 解析实际 ID（支持部分匹配） */
  resolveId(partialId: string): string | null {
    // 先尝试精确匹配
    const exactPath = this.getDataPath(partialId)
    if (existsSync(exactPath)) {
      return partialId
    }

    // 如果不支持部分匹配，直接返回 null
    if (!this.partialIdMatch) {
      return null
    }

    // 部分匹配
    const ids = this.listSync()
    const match = ids.find(id => id.startsWith(partialId) || id.includes(partialId))
    return match || null
  }

  /**
   * 同步列出所有实体 ID
   * @returns ID 数组
   */
  listSync(): string[] {
    if (!existsSync(this.dir)) {
      return []
    }
    const entries = readdirSync(this.dir)

    if (this.mode === 'directory') {
      // 目录模式：只返回包含数据文件的目录
      return entries.filter(entry => {
        const dataPath = join(this.dir, entry, this.dataFile)
        return existsSync(dataPath)
      })
    }

    // 文件模式：只返回对应扩展名的文件
    return entries
      .filter(f => f.endsWith(this.ext))
      .map(f => this.getIdFromEntry(f))
  }

  /**
   * 获取实体
   * @param id - 实体 ID（支持部分匹配）
   * @returns 实体数据，不存在返回 null
   */
  async get(id: string): Promise<T | null> {
    const resolvedId = this.resolveId(id)
    if (!resolvedId) return null
    return readJson<T>(this.getDataPath(resolvedId))
  }

  /**
   * 同步获取实体
   */
  getSync(id: string): T | null {
    const resolvedId = this.resolveId(id)
    if (!resolvedId) return null
    return readJson<T>(this.getDataPath(resolvedId))
  }

  /**
   * 保存实体
   * @param id - 实体 ID
   * @param data - 实体数据
   */
  async set(id: string, data: T): Promise<void> {
    if (this.mode === 'directory') {
      ensureDir(join(this.dir, id))
    }
    writeJson(this.getDataPath(id), data)
  }

  /**
   * 同步保存实体
   */
  setSync(id: string, data: T): void {
    if (this.mode === 'directory') {
      ensureDir(join(this.dir, id))
    }
    writeJson(this.getDataPath(id), data)
  }

  /**
   * 删除实体
   * @param id - 实体 ID
   * @returns 是否成功删除
   */
  async delete(id: string): Promise<boolean> {
    return this.deleteSync(id)
  }

  /**
   * 同步删除实体
   */
  deleteSync(id: string): boolean {
    const resolvedId = this.resolveId(id)
    if (!resolvedId) return false

    if (this.mode === 'directory') {
      const dirPath = join(this.dir, resolvedId)
      if (!existsSync(dirPath)) return false
      rmSync(dirPath, { recursive: true, force: true })
      return true
    }

    const filepath = this.getDataPath(resolvedId)
    if (!existsSync(filepath)) return false
    unlinkSync(filepath)
    return true
  }

  /**
   * 检查实体是否存在
   * @param id - 实体 ID
   */
  async exists(id: string): Promise<boolean> {
    return this.resolveId(id) !== null
  }

  /**
   * 同步检查实体是否存在
   */
  existsSync(id: string): boolean {
    return this.resolveId(id) !== null
  }

  /**
   * 列出所有实体 ID
   * @returns ID 数组
   */
  async list(): Promise<string[]> {
    return this.listSync()
  }

  /**
   * 获取所有实体
   * @returns 实体数组
   */
  async getAll(): Promise<T[]> {
    return this.getAllSync()
  }

  /**
   * 同步获取所有实体
   */
  getAllSync(): T[] {
    const ids = this.listSync()
    const results: T[] = []
    for (const id of ids) {
      const data = this.getSync(id)
      if (data !== null) {
        results.push(data)
      }
    }
    return results
  }

  /**
   * 获取所有实体的摘要
   * 需要在构造时提供 toSummary 函数
   * @returns 摘要数组
   */
  async getAllSummaries(): Promise<S[]> {
    const items = await this.getAll()
    if (!this.toSummary) {
      return items as unknown as S[]
    }
    return items.map(this.toSummary)
  }

  /**
   * 查询实体
   * @param filter - 过滤条件（对象或函数）
   * @returns 匹配的实体数组
   */
  async query(filter: QueryFilter<T>): Promise<T[]> {
    const items = await this.getAll()
    const predicate = typeof filter === 'function'
      ? filter
      : (item: T) => {
          for (const [key, value] of Object.entries(filter)) {
            if ((item as Record<string, unknown>)[key] !== value) {
              return false
            }
          }
          return true
        }
    return items.filter(predicate)
  }

  /**
   * 查询实体摘要
   * @param filter - 过滤条件（对象或函数）
   * @returns 匹配的摘要数组
   */
  async querySummaries(filter: QueryFilter<T>): Promise<S[]> {
    const items = await this.query(filter)
    if (!this.toSummary) {
      return items as unknown as S[]
    }
    return items.map(this.toSummary)
  }

  /**
   * 更新实体（部分更新）
   * @param id - 实体 ID
   * @param updates - 要更新的字段
   * @returns 是否成功更新
   */
  async update(id: string, updates: Partial<T>): Promise<boolean> {
    return this.updateSync(id, updates)
  }

  /**
   * 同步更新实体
   */
  updateSync(id: string, updates: Partial<T>): boolean {
    const resolvedId = this.resolveId(id)
    if (!resolvedId) return false

    const existing = this.getSync(resolvedId)
    if (existing === null) return false

    const updated = { ...existing, ...updates }
    this.setSync(resolvedId, updated)
    return true
  }
}
