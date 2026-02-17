import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { DATA_DIR } from '../../store/paths.js'
import type { HealthCheck } from '../types.js'

export const envIsolationCheck: HealthCheck = {
  name: 'env-isolation',
  description: 'Verify test environment isolation from production data',
  async run() {
    const details: string[] = []
    let score = 100

    // Check: production data should NOT be in tmpdir
    const resolvedDataDir = resolve(DATA_DIR)
    const resolvedTmpDir = resolve(tmpdir())
    const dataInTmp = resolvedDataDir.startsWith(resolvedTmpDir)

    if (dataInTmp) {
      score -= 50
      details.push(`Production data dir is in tmpdir: ${resolvedDataDir}`)
    } else {
      details.push(`Data dir OK: ${resolvedDataDir}`)
    }

    // Check: vitest.config.ts should set CAH_DATA_DIR
    const vitestConfigPath = join(process.cwd(), 'vitest.config.ts')
    if (existsSync(vitestConfigPath)) {
      try {
        const content = readFileSync(vitestConfigPath, 'utf-8')
        if (content.includes('CAH_DATA_DIR')) {
          details.push('vitest.config.ts sets CAH_DATA_DIR')
        } else {
          score -= 30
          details.push('vitest.config.ts does NOT set CAH_DATA_DIR - tests may use production data')
        }
      } catch {
        details.push('Cannot read vitest.config.ts')
      }
    }

    // Check: tests/setup.ts should have safety check
    const setupPath = join(process.cwd(), 'tests', 'setup.ts')
    if (existsSync(setupPath)) {
      try {
        const content = readFileSync(setupPath, 'utf-8')
        if (content.includes('tmp') || content.includes('Temp') || content.includes('TEMP')) {
          details.push('tests/setup.ts has temp directory safety check')
        } else {
          score -= 30
          details.push('tests/setup.ts may lack temp directory safety check')
        }
      } catch {
        details.push('Cannot read tests/setup.ts')
      }
    }

    score = Math.max(0, score)
    const status = score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    return {
      name: this.name,
      status,
      score,
      details,
      fixable: false,
    }
  },
}
