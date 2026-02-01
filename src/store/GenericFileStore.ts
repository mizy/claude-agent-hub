/**
 * 泛型文件存储类
 *
 * 基于文件系统的 JSON 存储实现，每个实体一个文件。
 */

import { existsSync, readdirSync, unlinkSync } from 'fs'
import { join, basename } from 'path'
import { readJson, writeJson, ensureDir } from './json.js'

/**
 * 文件存储配置
 */
export interface FileStoreOptions {
  /** 存储目录 */
  dir: string
  /** 文件扩展名，默认 .json */
  ext?: string
}

/**
 * 泛型文件存储类
 *
 * @example
 * ```ts
 * interface User { id: string; name: string }
 * const store = new FileStore<User>({ dir: 'data/users' })
 * await store.set('user-1', { id: 'user-1', name: 'Alice' })
 * const user = await store.get('user-1')
 * ```
 */
export class FileStore<T> {
  private dir: string
  private ext: string

  constructor(options: FileStoreOptions) {
    this.dir = options.dir
    this.ext = options.ext ?? '.json'
    ensureDir(this.dir)
  }

  /** 获取文件路径 */
  private getFilePath(id: string): string {
    return join(this.dir, `${id}${this.ext}`)
  }

  /** 从文件名提取 ID */
  private getIdFromFile(filename: string): string {
    return basename(filename, this.ext)
  }

  /**
   * 获取实体
   * @param id - 实体 ID
   * @returns 实体数据，不存在返回 null
   */
  async get(id: string): Promise<T | null> {
    const filepath = this.getFilePath(id)
    return readJson<T>(filepath)
  }

  /**
   * 保存实体
   * @param id - 实体 ID
   * @param data - 实体数据
   */
  async set(id: string, data: T): Promise<void> {
    const filepath = this.getFilePath(id)
    writeJson(filepath, data)
  }

  /**
   * 删除实体
   * @param id - 实体 ID
   * @returns 是否成功删除
   */
  async delete(id: string): Promise<boolean> {
    const filepath = this.getFilePath(id)
    if (!existsSync(filepath)) {
      return false
    }
    unlinkSync(filepath)
    return true
  }

  /**
   * 检查实体是否存在
   * @param id - 实体 ID
   */
  async exists(id: string): Promise<boolean> {
    return existsSync(this.getFilePath(id))
  }

  /**
   * 列出所有实体 ID
   * @returns ID 数组
   */
  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) {
      return []
    }
    const files = readdirSync(this.dir)
    return files
      .filter(f => f.endsWith(this.ext))
      .map(f => this.getIdFromFile(f))
  }

  /**
   * 获取所有实体
   * @returns 实体数组
   */
  async getAll(): Promise<T[]> {
    const ids = await this.list()
    const results: T[] = []
    for (const id of ids) {
      const data = await this.get(id)
      if (data !== null) {
        results.push(data)
      }
    }
    return results
  }
}
