import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createABTest,
  selectVariant,
  evaluateABTest,
  concludeABTest,
  calculateFitness,
  resetStore,
} from '../abTesting.js'
import type { PromptVersion, PromptVersionStats } from '../../types/promptVersion.js'

// Mock stores
vi.mock('../../store/PromptVersionStore.js', () => {
  const versions = new Map<string, PromptVersion>()
  return {
    getActiveVersion: vi.fn((persona: string) => {
      for (const v of versions.values()) {
        if (v.personaName === persona && v.status === 'active') return v
      }
      return null
    }),
    getPromptVersion: vi.fn((_persona: string, id: string) => versions.get(id) ?? null),
    rollbackToVersion: vi.fn((_persona: string, targetId: string) => {
      const target = versions.get(targetId)
      if (!target) return null
      // Retire current active, activate target
      for (const v of versions.values()) {
        if (v.personaName === target.personaName && v.status === 'active') {
          v.status = 'retired'
        }
      }
      target.status = 'active'
      return target
    }),
    _versions: versions,
  }
})

function makeStats(overrides: Partial<PromptVersionStats> = {}): PromptVersionStats {
  return {
    totalTasks: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    avgDurationMs: 0,
    ...overrides,
  }
}

function makeVersion(
  id: string,
  persona: string,
  status: 'active' | 'candidate' | 'retired',
  stats?: Partial<PromptVersionStats>
): PromptVersion {
  return {
    id,
    personaName: persona,
    version: 1,
    systemPrompt: `prompt-${id}`,
    changelog: 'test',
    stats: makeStats(stats),
    status,
    createdAt: new Date().toISOString(),
  }
}

// Access mocked versions map
async function getVersionsMap() {
  const mod = await import('../../store/PromptVersionStore.js')
  return (mod as unknown as { _versions: Map<string, PromptVersion> })._versions
}

describe('abTesting', () => {
  let versions: Map<string, PromptVersion>

  beforeEach(async () => {
    resetStore(true)
    versions = await getVersionsMap()
    versions.clear()
  })

  describe('createABTest', () => {
    it('creates test linking active and candidate versions', () => {
      versions.set('v-active', makeVersion('v-active', 'Pragmatist', 'active'))
      versions.set('v-candidate', makeVersion('v-candidate', 'Pragmatist', 'candidate'))

      const test = createABTest('Pragmatist', 'v-candidate')
      expect(test.id).toMatch(/^ab-/)
      expect(test.personaName).toBe('Pragmatist')
      expect(test.controlVersionId).toBe('v-active')
      expect(test.candidateVersionId).toBe('v-candidate')
      expect(test.status).toBe('running')
      expect(test.minSamples).toBe(5)
    })

    it('throws when no active version exists', () => {
      versions.set('v-candidate', makeVersion('v-candidate', 'Pragmatist', 'candidate'))
      expect(() => createABTest('Pragmatist', 'v-candidate')).toThrow('No active version')
    })

    it('throws when candidate version not found', () => {
      versions.set('v-active', makeVersion('v-active', 'Pragmatist', 'active'))
      expect(() => createABTest('Pragmatist', 'v-missing')).toThrow('not found')
    })
  })

  describe('selectVariant', () => {
    it('returns control or candidate when test is running', () => {
      versions.set('v-active', makeVersion('v-active', 'Pragmatist', 'active'))
      versions.set('v-candidate', makeVersion('v-candidate', 'Pragmatist', 'candidate'))
      createABTest('Pragmatist', 'v-candidate')

      const results = new Set<string>()
      // Run enough times to get both variants
      for (let i = 0; i < 100; i++) {
        const v = selectVariant('Pragmatist')
        if (v) results.add(v)
      }

      expect(results.has('v-active')).toBe(true)
      expect(results.has('v-candidate')).toBe(true)
    })

    it('returns null when no test is running', () => {
      expect(selectVariant('Pragmatist')).toBeNull()
    })
  })

  describe('evaluateABTest', () => {
    it('returns null when samples insufficient', () => {
      versions.set('v-active', makeVersion('v-active', 'Pragmatist', 'active', { totalTasks: 2 }))
      versions.set(
        'v-candidate',
        makeVersion('v-candidate', 'Pragmatist', 'candidate', { totalTasks: 3 })
      )
      const test = createABTest('Pragmatist', 'v-candidate')

      expect(evaluateABTest(test.id)).toBeNull()
    })

    it('evaluates correctly and picks winner by fitness', () => {
      versions.set(
        'v-active',
        makeVersion('v-active', 'Pragmatist', 'active', {
          totalTasks: 10,
          successCount: 6,
          failureCount: 4,
          successRate: 0.6,
          avgDurationMs: 300_000,
        })
      )
      versions.set(
        'v-candidate',
        makeVersion('v-candidate', 'Pragmatist', 'candidate', {
          totalTasks: 10,
          successCount: 9,
          failureCount: 1,
          successRate: 0.9,
          avgDurationMs: 200_000,
        })
      )
      const test = createABTest('Pragmatist', 'v-candidate')
      const result = evaluateABTest(test.id)

      expect(result).not.toBeNull()
      expect(result!.winner).toBe('candidate')
      expect(result!.fitnessCandidate).toBeGreaterThan(result!.fitnessControl)
      expect(result!.recommendation).toContain('Recommend promoting candidate')
    })

    it('returns inconclusive when fitness difference is small', () => {
      versions.set(
        'v-active',
        makeVersion('v-active', 'Pragmatist', 'active', {
          totalTasks: 10,
          successCount: 8,
          successRate: 0.8,
          avgDurationMs: 200_000,
        })
      )
      versions.set(
        'v-candidate',
        makeVersion('v-candidate', 'Pragmatist', 'candidate', {
          totalTasks: 10,
          successCount: 8,
          successRate: 0.81,
          avgDurationMs: 195_000,
        })
      )
      const test = createABTest('Pragmatist', 'v-candidate')
      const result = evaluateABTest(test.id)

      expect(result).not.toBeNull()
      expect(result!.winner).toBe('inconclusive')
    })
  })

  describe('concludeABTest', () => {
    it('promotes candidate when it wins', async () => {
      const { rollbackToVersion } = await import('../../store/PromptVersionStore.js')

      versions.set(
        'v-active',
        makeVersion('v-active', 'Pragmatist', 'active', {
          totalTasks: 10,
          successCount: 5,
          successRate: 0.5,
          avgDurationMs: 400_000,
        })
      )
      versions.set(
        'v-candidate',
        makeVersion('v-candidate', 'Pragmatist', 'candidate', {
          totalTasks: 10,
          successCount: 9,
          successRate: 0.9,
          avgDurationMs: 100_000,
        })
      )

      const test = createABTest('Pragmatist', 'v-candidate')
      concludeABTest(test.id)

      expect(rollbackToVersion).toHaveBeenCalledWith('Pragmatist', 'v-candidate')
    })

    it('does not promote when control wins', async () => {
      const { rollbackToVersion } = await import('../../store/PromptVersionStore.js')
      vi.mocked(rollbackToVersion).mockClear()

      versions.set(
        'v-active',
        makeVersion('v-active', 'Pragmatist', 'active', {
          totalTasks: 10,
          successCount: 9,
          successRate: 0.9,
          avgDurationMs: 100_000,
        })
      )
      versions.set(
        'v-candidate',
        makeVersion('v-candidate', 'Pragmatist', 'candidate', {
          totalTasks: 10,
          successCount: 4,
          successRate: 0.4,
          avgDurationMs: 400_000,
        })
      )

      const test = createABTest('Pragmatist', 'v-candidate')
      concludeABTest(test.id)

      expect(rollbackToVersion).not.toHaveBeenCalled()
    })
  })

  describe('calculateFitness', () => {
    it('computes fitness correctly', () => {
      // Perfect stats
      const perfect = calculateFitness(makeStats({ successRate: 1.0, avgDurationMs: 0 }))
      // successRate*0.6 + speedScore*0.2 + efficiency*0.1 + satisfaction*0.1
      // = 1.0*0.6 + 1.0*0.2 + 0.5*0.1 + 1.0*0.1 = 0.95
      expect(perfect).toBeCloseTo(0.95, 2)

      // Zero success, max duration
      const worst = calculateFitness(makeStats({ successRate: 0, avgDurationMs: 600_000 }))
      // = 0*0.6 + 0*0.2 + 0.5*0.1 + 1.0*0.1 = 0.15
      expect(worst).toBeCloseTo(0.15, 2)

      // Mid stats
      const mid = calculateFitness(makeStats({ successRate: 0.5, avgDurationMs: 300_000 }))
      // = 0.5*0.6 + 0.5*0.2 + 0.5*0.1 + 1.0*0.1 = 0.55
      expect(mid).toBeCloseTo(0.55, 2)
    })

    it('caps duration at max', () => {
      const overMax = calculateFitness(makeStats({ successRate: 1.0, avgDurationMs: 1_200_000 }))
      const atMax = calculateFitness(makeStats({ successRate: 1.0, avgDurationMs: 600_000 }))
      expect(overMax).toBe(atMax)
    })
  })
})
