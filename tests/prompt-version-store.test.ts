/**
 * PromptVersionStore 单元测试
 *
 * 测试 save/get/list/updateMetrics/rollback 等核心操作
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

import {
  generateVersionId,
  savePromptVersion,
  getPromptVersion,
  getAllVersions,
  getActiveVersion,
  getLatestVersion,
  updatePromptVersionStats,
  rollbackToVersion,
} from '../src/store/PromptVersionStore.js'
import { PROMPT_VERSIONS_DIR } from '../src/store/paths.js'
import type { PromptVersion, PromptVersionStats } from '../src/types/promptVersion.js'

const TEST_PERSONA = `test-persona-${Date.now()}`
const createdPersonas: string[] = [TEST_PERSONA]

function createTestVersion(overrides: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: generateVersionId(),
    personaName: TEST_PERSONA,
    version: 1,
    systemPrompt: 'You are a test persona.',
    changelog: 'Initial version',
    stats: {
      totalTasks: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDurationMs: 0,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('PromptVersionStore', () => {
  afterAll(() => {
    // Clean up test persona directories
    for (const persona of createdPersonas) {
      const dir = join(PROMPT_VERSIONS_DIR, persona)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  describe('generateVersionId', () => {
    it('should generate IDs with pv- prefix', () => {
      const id = generateVersionId()
      expect(id).toMatch(/^pv-\d{14}-[a-z0-9]+$/)
    })

    it('should generate unique IDs', () => {
      const id1 = generateVersionId()
      const id2 = generateVersionId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('savePromptVersion / getPromptVersion', () => {
    it('should save and retrieve a version', () => {
      const version = createTestVersion()
      savePromptVersion(version)

      const retrieved = getPromptVersion(TEST_PERSONA, version.id)
      expect(retrieved).toEqual(version)
    })

    it('should return null for non-existent version', () => {
      const result = getPromptVersion(TEST_PERSONA, 'pv-nonexistent')
      expect(result).toBe(null)
    })

    it('should return null for non-existent persona', () => {
      const result = getPromptVersion('nonexistent-persona', 'pv-nonexistent')
      expect(result).toBe(null)
    })
  })

  describe('getAllVersions', () => {
    it('should return versions sorted by version number descending', () => {
      const persona = `test-list-${Date.now()}`
      createdPersonas.push(persona)

      const v1 = createTestVersion({ personaName: persona, version: 1 })
      const v2 = createTestVersion({ personaName: persona, version: 2 })
      const v3 = createTestVersion({ personaName: persona, version: 3 })

      savePromptVersion(v1)
      savePromptVersion(v3) // save out of order
      savePromptVersion(v2)

      const versions = getAllVersions(persona)
      expect(versions).toHaveLength(3)
      expect(versions[0]!.version).toBe(3)
      expect(versions[1]!.version).toBe(2)
      expect(versions[2]!.version).toBe(1)
    })

    it('should return empty array for persona with no versions', () => {
      const versions = getAllVersions('nonexistent-persona-xyz')
      expect(versions).toEqual([])
    })
  })

  describe('getActiveVersion', () => {
    it('should return the active version', () => {
      const persona = `test-active-${Date.now()}`
      createdPersonas.push(persona)

      const active = createTestVersion({ personaName: persona, status: 'active' })
      const retired = createTestVersion({ personaName: persona, version: 2, status: 'retired' })

      savePromptVersion(active)
      savePromptVersion(retired)

      const result = getActiveVersion(persona)
      expect(result).not.toBe(null)
      expect(result!.id).toBe(active.id)
      expect(result!.status).toBe('active')
    })

    it('should return null when no active version exists', () => {
      const persona = `test-no-active-${Date.now()}`
      createdPersonas.push(persona)

      const retired = createTestVersion({ personaName: persona, status: 'retired' })
      savePromptVersion(retired)

      const result = getActiveVersion(persona)
      expect(result).toBe(null)
    })
  })

  describe('getLatestVersion', () => {
    it('should return the version with highest version number', () => {
      const persona = `test-latest-${Date.now()}`
      createdPersonas.push(persona)

      const v1 = createTestVersion({ personaName: persona, version: 1 })
      const v5 = createTestVersion({ personaName: persona, version: 5 })
      const v3 = createTestVersion({ personaName: persona, version: 3 })

      savePromptVersion(v1)
      savePromptVersion(v5)
      savePromptVersion(v3)

      const latest = getLatestVersion(persona)
      expect(latest).not.toBe(null)
      expect(latest!.version).toBe(5)
    })

    it('should return null for persona with no versions', () => {
      expect(getLatestVersion('nonexistent-persona-xyz')).toBe(null)
    })
  })

  describe('updatePromptVersionStats', () => {
    it('should update stats for a version', () => {
      const version = createTestVersion()
      savePromptVersion(version)

      const newStats: PromptVersionStats = {
        totalTasks: 10,
        successCount: 8,
        failureCount: 2,
        successRate: 0.8,
        avgDurationMs: 5000,
        lastUsedAt: new Date().toISOString(),
      }

      const updated = updatePromptVersionStats(TEST_PERSONA, version.id, newStats)
      expect(updated).toBe(true)

      const retrieved = getPromptVersion(TEST_PERSONA, version.id)
      expect(retrieved!.stats).toEqual(newStats)
      // Other fields should be unchanged
      expect(retrieved!.systemPrompt).toBe(version.systemPrompt)
      expect(retrieved!.status).toBe(version.status)
    })
  })

  describe('rollbackToVersion', () => {
    it('should retire current active and activate target', () => {
      const persona = `test-rollback-${Date.now()}`
      createdPersonas.push(persona)

      const v1 = createTestVersion({
        personaName: persona,
        version: 1,
        status: 'retired',
        systemPrompt: 'Version 1 prompt',
      })
      const v2 = createTestVersion({
        personaName: persona,
        version: 2,
        status: 'active',
        systemPrompt: 'Version 2 prompt',
      })

      savePromptVersion(v1)
      savePromptVersion(v2)

      // Rollback to v1
      const result = rollbackToVersion(persona, v1.id)
      expect(result).not.toBe(null)
      expect(result!.status).toBe('active')
      expect(result!.version).toBe(1)

      // v2 should now be retired
      const v2After = getPromptVersion(persona, v2.id)
      expect(v2After!.status).toBe('retired')

      // Active version should be v1
      const active = getActiveVersion(persona)
      expect(active!.id).toBe(v1.id)
    })

    it('should return null for non-existent target version', () => {
      const result = rollbackToVersion(TEST_PERSONA, 'pv-nonexistent')
      expect(result).toBe(null)
    })

    it('should handle rollback when target is already active', () => {
      const persona = `test-rollback-same-${Date.now()}`
      createdPersonas.push(persona)

      const v1 = createTestVersion({ personaName: persona, status: 'active' })
      savePromptVersion(v1)

      const result = rollbackToVersion(persona, v1.id)
      expect(result).not.toBe(null)
      expect(result!.status).toBe('active')
    })
  })
})
