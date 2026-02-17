import { describe, it, expect, vi } from 'vitest'
import { runSelfcheck, runFixes } from '../index.js'
import type { SelfcheckReport } from '../types.js'

// Mock all checks to control behavior
vi.mock('../checks/dataIntegrity.js', () => ({
  dataIntegrityCheck: {
    name: 'data-integrity',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'data-integrity',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

vi.mock('../checks/processHealth.js', () => ({
  processHealthCheck: {
    name: 'process-health',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'process-health',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

vi.mock('../checks/envIsolation.js', () => ({
  envIsolationCheck: {
    name: 'env-isolation',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'env-isolation',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

vi.mock('../checks/versionConsistency.js', () => ({
  versionConsistencyCheck: {
    name: 'version-consistency',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'version-consistency',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

vi.mock('../checks/queueHealth.js', () => ({
  queueHealthCheck: {
    name: 'queue-health',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'queue-health',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

vi.mock('../checks/configValidity.js', () => ({
  configValidityCheck: {
    name: 'config-validity',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'config-validity',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

vi.mock('../checks/backendAvailability.js', () => ({
  backendAvailabilityCheck: {
    name: 'backend-availability',
    description: 'mock',
    run: vi.fn().mockResolvedValue({
      name: 'backend-availability',
      status: 'pass',
      score: 100,
      details: [],
      fixable: false,
    }),
  },
}))

describe('runSelfcheck', () => {
  it('returns 100 score when all checks pass', async () => {
    const report = await runSelfcheck()
    expect(report.totalScore).toBe(100)
    expect(report.hasFailed).toBe(false)
    expect(report.hasWarning).toBe(false)
    expect(report.checks).toHaveLength(7)
  })
})

describe('runFixes', () => {
  it('executes fix for failed fixable checks', async () => {
    const fixFn = vi.fn().mockResolvedValue('Fixed something')
    const report: SelfcheckReport = {
      timestamp: Date.now(),
      checks: [
        { name: 'test-check', status: 'fail', score: 50, details: [], fixable: true, fix: fixFn },
        { name: 'other-check', status: 'pass', score: 100, details: [], fixable: false },
      ],
      totalScore: 75,
      hasFailed: true,
      hasWarning: false,
    }

    const results = await runFixes(report)
    expect(results).toHaveLength(1)
    expect(results[0]).toBe('[test-check] Fixed something')
    expect(fixFn).toHaveBeenCalledOnce()
  })

  it('skips non-failed or non-fixable checks', async () => {
    const report: SelfcheckReport = {
      timestamp: Date.now(),
      checks: [
        { name: 'warning-check', status: 'warning', score: 80, details: [], fixable: true },
        { name: 'not-fixable', status: 'fail', score: 50, details: [], fixable: false },
      ],
      totalScore: 65,
      hasFailed: true,
      hasWarning: true,
    }

    const results = await runFixes(report)
    expect(results).toHaveLength(0)
  })
})

describe('Diagnosis type', () => {
  it('diagnosis field is included in check results', async () => {
    const { versionConsistencyCheck } = await import('../checks/versionConsistency.js')
    const mockRun = vi.mocked(versionConsistencyCheck.run)
    mockRun.mockResolvedValueOnce({
      name: 'version-consistency',
      status: 'fail',
      score: 70,
      details: ['Daemon running stale code'],
      fixable: true,
      diagnosis: {
        category: 'stale_code',
        rootCause: 'Daemon started before latest build',
        suggestedFix: 'Restart daemon',
      },
    })

    const report = await runSelfcheck()
    const vcCheck = report.checks.find(c => c.name === 'version-consistency')
    expect(vcCheck?.diagnosis).toBeDefined()
    expect(vcCheck?.diagnosis?.category).toBe('stale_code')
  })
})
