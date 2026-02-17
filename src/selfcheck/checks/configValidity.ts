import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import YAML from 'yaml'
import { configSchema } from '../../config/schema.js'
import type { HealthCheck } from '../types.js'

const CONFIG_FILENAME = '.claude-agent-hub.yaml'

export const configValidityCheck: HealthCheck = {
  name: 'config-validity',
  description: 'Check configuration file exists and is valid YAML with correct schema',
  async run() {
    const details: string[] = []
    let score = 100

    const globalPath = join(homedir(), CONFIG_FILENAME)
    const projectPath = join(process.cwd(), CONFIG_FILENAME)

    const hasGlobal = existsSync(globalPath)
    const hasProject = existsSync(projectPath)

    if (!hasGlobal && !hasProject) {
      details.push('No config file found (using defaults)')
      return { name: this.name, status: 'warning', score: 80, details, fixable: false }
    }

    // Validate each config file
    const files = [
      { path: globalPath, label: 'global', exists: hasGlobal },
      { path: projectPath, label: 'project', exists: hasProject },
    ]

    for (const { path, label, exists } of files) {
      if (!exists) continue

      let raw: string
      try {
        raw = readFileSync(path, 'utf-8')
      } catch {
        score -= 20
        details.push(`Cannot read ${label} config: ${path}`)
        continue
      }

      let parsed: unknown
      try {
        parsed = YAML.parse(raw)
      } catch {
        score -= 30
        details.push(`${label} config has invalid YAML syntax: ${path}`)
        continue
      }

      // null/empty YAML is fine (empty config file)
      if (parsed == null) {
        details.push(`${label} config is empty (using defaults)`)
        continue
      }

      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        score -= 20
        details.push(`${label} config is not a YAML mapping: ${path}`)
        continue
      }

      const result = configSchema.safeParse(parsed)
      if (!result.success) {
        score -= 15
        const issues = result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`)
        details.push(`${label} config has schema issues: ${issues.join('; ')}`)
      } else {
        details.push(`${label} config valid: ${path}`)
      }
    }

    score = Math.max(0, score)
    const status = score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    return { name: this.name, status, score, details, fixable: false }
  },
}
