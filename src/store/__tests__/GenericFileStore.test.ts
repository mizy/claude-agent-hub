/**
 * GenericFileStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { FileStore } from '../GenericFileStore.js'

interface TestEntity {
  id: string
  name: string
  status: 'active' | 'inactive'
  count: number
}

interface TestSummary {
  id: string
  name: string
}

const TEST_DIR = join(process.cwd(), '.test-store-data')

describe('FileStore', () => {
  let store: FileStore<TestEntity, TestSummary>

  beforeEach(() => {
    // 清理并创建测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })

    store = new FileStore<TestEntity, TestSummary>({
      dir: TEST_DIR,
      toSummary: (e) => ({ id: e.id, name: e.name }),
    })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe('基础 CRUD', () => {
    it('set 和 get 应正常工作', async () => {
      const entity: TestEntity = {
        id: 'test-1',
        name: 'Test Entity',
        status: 'active',
        count: 10,
      }

      await store.set('test-1', entity)
      const result = await store.get('test-1')

      expect(result).toEqual(entity)
    })

    it('get 不存在的实体应返回 null', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })

    it('delete 应删除实体', async () => {
      await store.set('to-delete', {
        id: 'to-delete',
        name: 'Delete Me',
        status: 'inactive',
        count: 0,
      })

      const deleted = await store.delete('to-delete')
      expect(deleted).toBe(true)

      const result = await store.get('to-delete')
      expect(result).toBeNull()
    })

    it('delete 不存在的实体应返回 false', async () => {
      const deleted = await store.delete('non-existent')
      expect(deleted).toBe(false)
    })

    it('exists 应正确检测', async () => {
      await store.set('exists-test', {
        id: 'exists-test',
        name: 'Exists',
        status: 'active',
        count: 1,
      })

      expect(await store.exists('exists-test')).toBe(true)
      expect(await store.exists('not-exists')).toBe(false)
    })

    it('update 应部分更新实体', async () => {
      await store.set('update-test', {
        id: 'update-test',
        name: 'Original',
        status: 'active',
        count: 5,
      })

      const updated = await store.update('update-test', { name: 'Updated', count: 10 })
      expect(updated).toBe(true)

      const result = await store.get('update-test')
      expect(result).toEqual({
        id: 'update-test',
        name: 'Updated',
        status: 'active',
        count: 10,
      })
    })

    it('update 不存在的实体应返回 false', async () => {
      const updated = await store.update('non-existent', { name: 'Test' })
      expect(updated).toBe(false)
    })
  })

  describe('列表和查询', () => {
    beforeEach(async () => {
      await store.set('entity-1', { id: 'entity-1', name: 'First', status: 'active', count: 10 })
      await store.set('entity-2', { id: 'entity-2', name: 'Second', status: 'inactive', count: 20 })
      await store.set('entity-3', { id: 'entity-3', name: 'Third', status: 'active', count: 30 })
    })

    it('list 应返回所有 ID', async () => {
      const ids = await store.list()
      expect(ids.sort()).toEqual(['entity-1', 'entity-2', 'entity-3'])
    })

    it('getAll 应返回所有实体', async () => {
      const all = await store.getAll()
      expect(all).toHaveLength(3)
      expect(all.map(e => e.id).sort()).toEqual(['entity-1', 'entity-2', 'entity-3'])
    })

    it('getAllSummaries 应返回摘要', async () => {
      const summaries = await store.getAllSummaries()
      expect(summaries).toHaveLength(3)
      expect(summaries.every(s => 'id' in s && 'name' in s && !('status' in s))).toBe(true)
    })

    it('query 使用对象过滤', async () => {
      const active = await store.query({ status: 'active' })
      expect(active).toHaveLength(2)
      expect(active.every(e => e.status === 'active')).toBe(true)
    })

    it('query 使用函数过滤', async () => {
      const highCount = await store.query((e) => e.count >= 20)
      expect(highCount).toHaveLength(2)
      expect(highCount.map(e => e.id).sort()).toEqual(['entity-2', 'entity-3'])
    })

    it('querySummaries 应返回过滤后的摘要', async () => {
      const summaries = await store.querySummaries({ status: 'active' })
      expect(summaries).toHaveLength(2)
      expect(summaries.every(s => !('status' in s))).toBe(true)
    })
  })

  describe('无 toSummary 的情况', () => {
    let basicStore: FileStore<TestEntity>

    beforeEach(() => {
      basicStore = new FileStore<TestEntity>({ dir: TEST_DIR })
    })

    it('getAllSummaries 应返回完整实体', async () => {
      await basicStore.set('basic-1', {
        id: 'basic-1',
        name: 'Basic',
        status: 'active',
        count: 1,
      })

      const summaries = await basicStore.getAllSummaries()
      expect(summaries[0]).toHaveProperty('status')
      expect(summaries[0]).toHaveProperty('count')
    })
  })

  describe('目录模式', () => {
    let dirStore: FileStore<TestEntity, TestSummary>
    const DIR_STORE_PATH = join(TEST_DIR, 'dir-store')

    beforeEach(() => {
      if (existsSync(DIR_STORE_PATH)) {
        rmSync(DIR_STORE_PATH, { recursive: true, force: true })
      }
      mkdirSync(DIR_STORE_PATH, { recursive: true })

      dirStore = new FileStore<TestEntity, TestSummary>({
        dir: DIR_STORE_PATH,
        mode: 'directory',
        dataFile: 'entity.json',
        partialIdMatch: true,
        toSummary: (e) => ({ id: e.id, name: e.name }),
      })
    })

    it('set 应在子目录中创建文件', async () => {
      const entity: TestEntity = {
        id: 'dir-test-1',
        name: 'Dir Test',
        status: 'active',
        count: 10,
      }

      await dirStore.set('dir-test-1', entity)

      // 验证目录结构
      expect(existsSync(join(DIR_STORE_PATH, 'dir-test-1'))).toBe(true)
      expect(existsSync(join(DIR_STORE_PATH, 'dir-test-1', 'entity.json'))).toBe(true)

      const result = await dirStore.get('dir-test-1')
      expect(result).toEqual(entity)
    })

    it('delete 应删除整个目录', async () => {
      await dirStore.set('to-delete', {
        id: 'to-delete',
        name: 'Delete Me',
        status: 'inactive',
        count: 0,
      })

      expect(existsSync(join(DIR_STORE_PATH, 'to-delete'))).toBe(true)

      const deleted = await dirStore.delete('to-delete')
      expect(deleted).toBe(true)
      expect(existsSync(join(DIR_STORE_PATH, 'to-delete'))).toBe(false)
    })

    it('部分 ID 匹配应正常工作', async () => {
      await dirStore.set('task-20260201-120000-abc', {
        id: 'task-20260201-120000-abc',
        name: 'Task ABC',
        status: 'active',
        count: 1,
      })

      // 使用部分 ID 查找
      const result = await dirStore.get('task-20260201')
      expect(result).not.toBeNull()
      expect(result?.id).toBe('task-20260201-120000-abc')
    })

    it('resolveId 应返回匹配的完整 ID', () => {
      dirStore.setSync('test-entity-abc123', {
        id: 'test-entity-abc123',
        name: 'Test',
        status: 'active',
        count: 0,
      })

      expect(dirStore.resolveId('test-entity-abc123')).toBe('test-entity-abc123')
      expect(dirStore.resolveId('test-entity')).toBe('test-entity-abc123')
      expect(dirStore.resolveId('non-existent')).toBeNull()
    })

    it('getEntityPath 应返回目录路径', () => {
      const path = dirStore.getEntityPath('my-entity')
      expect(path).toBe(join(DIR_STORE_PATH, 'my-entity'))
    })

    it('同步方法应正常工作', () => {
      const entity: TestEntity = {
        id: 'sync-test',
        name: 'Sync',
        status: 'active',
        count: 5,
      }

      dirStore.setSync('sync-test', entity)
      expect(dirStore.getSync('sync-test')).toEqual(entity)
      expect(dirStore.existsSync('sync-test')).toBe(true)

      dirStore.updateSync('sync-test', { count: 10 })
      expect(dirStore.getSync('sync-test')?.count).toBe(10)

      expect(dirStore.getAllSync()).toHaveLength(1)
      expect(dirStore.listSync()).toEqual(['sync-test'])

      dirStore.deleteSync('sync-test')
      expect(dirStore.existsSync('sync-test')).toBe(false)
    })
  })
})
