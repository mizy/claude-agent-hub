import { readdirSync, readFileSync, existsSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TASKS_DIR, FILE_NAMES } from '../../store/paths.js'
import type { HealthCheck, CheckResult, Diagnosis } from '../types.js'

const REQUIRED_FILES = [FILE_NAMES.TASK, FILE_NAMES.WORKFLOW, FILE_NAMES.INSTANCE] as const

function tryParseJson(filePath: string): boolean {
  try {
    JSON.parse(readFileSync(filePath, 'utf-8'))
    return true
  } catch {
    return false
  }
}

export const dataIntegrityCheck: HealthCheck = {
  name: 'data-integrity',
  description: 'Check task data files for consistency and corruption',
  async run() {
    const details: string[] = []
    let missingCount = 0
    let corruptCount = 0
    const corruptFiles: string[] = []

    if (!existsSync(TASKS_DIR)) {
      return { name: this.name, status: 'pass', score: 100, details: ['No tasks directory'], fixable: false }
    }

    let taskDirs: string[]
    try {
      taskDirs = readdirSync(TASKS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('task-'))
        .map((d) => d.name)
    } catch {
      return { name: this.name, status: 'fail', score: 0, details: ['Cannot read tasks directory'], fixable: false }
    }

    for (const dir of taskDirs) {
      const taskDir = join(TASKS_DIR, dir)

      // Only check dirs that have task.json (valid task dirs)
      if (!existsSync(join(taskDir, FILE_NAMES.TASK))) {
        continue
      }

      // Skip cancelled tasks — they may have been cancelled before workflow generation
      try {
        const taskData = JSON.parse(readFileSync(join(taskDir, FILE_NAMES.TASK), 'utf-8'))
        if (taskData.status === 'cancelled') continue
      } catch {
        // If task.json is unreadable, the corrupt check below will catch it
      }

      for (const file of REQUIRED_FILES) {
        const filePath = join(taskDir, file)
        if (!existsSync(filePath)) {
          missingCount++
          details.push(`Missing: ${dir}/${file}`)
        } else if (!tryParseJson(filePath)) {
          corruptCount++
          corruptFiles.push(filePath)
          details.push(`Corrupt: ${dir}/${file}`)
        }
      }
    }

    const score = Math.max(0, 100 - missingCount * 5 - corruptCount * 10)
    const status = score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    let diagnosis: Diagnosis | undefined
    if (corruptCount > 0) {
      diagnosis = {
        category: 'corrupt_data',
        rootCause: `${corruptCount} JSON file(s) are corrupted and cannot be parsed`,
        suggestedFix: 'Back up corrupt files and reset to empty JSON (cah selfcheck --fix)',
      }
    } else if (missingCount > 0) {
      diagnosis = {
        category: 'corrupt_data',
        rootCause: `${missingCount} required file(s) are missing from task directories`,
        suggestedFix: 'Investigate missing files manually — may indicate incomplete task creation',
      }
    }

    const result: CheckResult = {
      name: this.name,
      status,
      score,
      details,
      fixable: corruptFiles.length > 0,
      diagnosis,
    }

    if (corruptFiles.length > 0) {
      result.fix = async () => {
        let fixed = 0
        for (const filePath of corruptFiles) {
          try {
            renameSync(filePath, filePath + '.bak')
            writeFileSync(filePath, '{}', 'utf-8')
            fixed++
          } catch {
            // skip files we can't fix
          }
        }
        return `Backed up and reset ${fixed} corrupt JSON file(s)`
      }
    }

    return result
  },
}
