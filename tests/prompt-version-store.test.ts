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

const TEST_AGENT = `test-agent-${Date.now()}`
const createdAgents: string[] = [TEST_AGENT]

function createTestVersion(overrides: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: generateVersionId(),
    agentName: TEST_AGENT,
    version: 1,
    systemPrompt: 'You are a test agent.',
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
    // Clean up test agent directories
    for (const agent of createdAgents) {
      const dir = join(PROMPT_VERSIONS_DIR, agent)
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

      const retrieved = getPromptVersion(TEST_AGENT, version.id)
      expect(retrieved).toEqual(version)
    })

    it('should return null for non-existent version', () => {
      const result = getPromptVersion(TEST_AGENT, 'pv-nonexistent')
      expect(result).toBe(null)
    })

    it('should return null for non-existent agent', () => {
      const result = getPromptVersion('nonexistent-agent', 'pv-nonexistent')
      expect(result).toBe(null)
    })
  })

  describe('getAllVersions', () => {
    it('should return versions sorted by version number descending', () => {
      const agent = `test-list-${Date.now()}`
      createdAgents.push(agent)

      const v1 = createTestVersion({ agentName: agent, version: 1 })
      const v2 = createTestVersion({ agentName: agent, version: 2 })
      const v3 = createTestVersion({ agentName: agent, version: 3 })

      savePromptVersion(v1)
      savePromptVersion(v3) // save out of order
      savePromptVersion(v2)

      const versions = getAllVersions(agent)
      expect(versions).toHaveLength(3)
      expect(versions[0]!.version).toBe(3)
      expect(versions[1]!.version).toBe(2)
      expect(versions[2]!.version).toBe(1)
    })

    it('should return empty array for agent with no versions', () => {
      const versions = getAllVersions('nonexistent-agent-xyz')
      expect(versions).toEqual([])
    })
  })

  describe('getActiveVersion', () => {
    it('should return the active version', () => {
      const agent = `test-active-${Date.now()}`
      createdAgents.push(agent)

      const active = createTestVersion({ agentName: agent, status: 'active' })
      const retired = createTestVersion({ agentName: agent, version: 2, status: 'retired' })

      savePromptVersion(active)
      savePromptVersion(retired)

      const result = getActiveVersion(agent)
      expect(result).not.toBe(null)
      expect(result!.id).toBe(active.id)
      expect(result!.status).toBe('active')
    })

    it('should return null when no active version exists', () => {
      const agent = `test-no-active-${Date.now()}`
      createdAgents.push(agent)

      const retired = createTestVersion({ agentName: agent, status: 'retired' })
      savePromptVersion(retired)

      const result = getActiveVersion(agent)
      expect(result).toBe(null)
    })
  })

  describe('getLatestVersion', () => {
    it('should return the version with highest version number', () => {
      const agent = `test-latest-${Date.now()}`
      createdAgents.push(agent)

      const v1 = createTestVersion({ agentName: agent, version: 1 })
      const v5 = createTestVersion({ agentName: agent, version: 5 })
      const v3 = createTestVersion({ agentName: agent, version: 3 })

      savePromptVersion(v1)
      savePromptVersion(v5)
      savePromptVersion(v3)

      const latest = getLatestVersion(agent)
      expect(latest).not.toBe(null)
      expect(latest!.version).toBe(5)
    })

    it('should return null for agent with no versions', () => {
      expect(getLatestVersion('nonexistent-agent-xyz')).toBe(null)
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

      const updated = updatePromptVersionStats(TEST_AGENT, version.id, newStats)
      expect(updated).toBe(true)

      const retrieved = getPromptVersion(TEST_AGENT, version.id)
      expect(retrieved!.stats).toEqual(newStats)
      // Other fields should be unchanged
      expect(retrieved!.systemPrompt).toBe(version.systemPrompt)
      expect(retrieved!.status).toBe(version.status)
    })
  })

  describe('rollbackToVersion', () => {
    it('should retire current active and activate target', () => {
      const agent = `test-rollback-${Date.now()}`
      createdAgents.push(agent)

      const v1 = createTestVersion({
        agentName: agent,
        version: 1,
        status: 'retired',
        systemPrompt: 'Version 1 prompt',
      })
      const v2 = createTestVersion({
        agentName: agent,
        version: 2,
        status: 'active',
        systemPrompt: 'Version 2 prompt',
      })

      savePromptVersion(v1)
      savePromptVersion(v2)

      // Rollback to v1
      const result = rollbackToVersion(agent, v1.id)
      expect(result).not.toBe(null)
      expect(result!.status).toBe('active')
      expect(result!.version).toBe(1)

      // v2 should now be retired
      const v2After = getPromptVersion(agent, v2.id)
      expect(v2After!.status).toBe('retired')

      // Active version should be v1
      const active = getActiveVersion(agent)
      expect(active!.id).toBe(v1.id)
    })

    it('should return null for non-existent target version', () => {
      const result = rollbackToVersion(TEST_AGENT, 'pv-nonexistent')
      expect(result).toBe(null)
    })

    it('should handle rollback when target is already active', () => {
      const agent = `test-rollback-same-${Date.now()}`
      createdAgents.push(agent)

      const v1 = createTestVersion({ agentName: agent, status: 'active' })
      savePromptVersion(v1)

      const result = rollbackToVersion(agent, v1.id)
      expect(result).not.toBe(null)
      expect(result!.status).toBe('active')
    })
  })
})
