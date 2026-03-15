/**
 * Migrate legacy log/pid files to new organized directory structure
 *
 * Old layout: all logs and pid files scattered in DATA_DIR root
 * New layout:
 *   logs/  — daemon.log, daemon.err.log, dashboard.log, runner.log,
 *            conversation.jsonl, lifecycle.jsonl, prompts/
 *   pids/  — daemon.pid, dashboard.pid
 *   consciousness/ — consciousness.jsonl, reflections.jsonl (moved from root)
 *
 * Safe to call multiple times — skips if source doesn't exist or target already exists.
 */

import { existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { DATA_DIR, LOGS_DIR, PIDS_DIR } from './paths.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('migrate-logs')

interface MigrationRule {
  from: string
  to: string
}

function buildRules(): MigrationRule[] {
  return [
    // Log files: root → logs/
    { from: join(DATA_DIR, 'daemon.log'), to: join(LOGS_DIR, 'daemon.log') },
    { from: join(DATA_DIR, 'daemon.log.old'), to: join(LOGS_DIR, 'daemon.log.old') },
    { from: join(DATA_DIR, 'daemon.err.log'), to: join(LOGS_DIR, 'daemon.err.log') },
    { from: join(DATA_DIR, 'daemon.err.log.old'), to: join(LOGS_DIR, 'daemon.err.log.old') },
    { from: join(DATA_DIR, 'dashboard.log'), to: join(LOGS_DIR, 'dashboard.log') },
    { from: join(DATA_DIR, 'runner.log'), to: join(LOGS_DIR, 'runner.log') },
    { from: join(DATA_DIR, 'conversation.jsonl'), to: join(LOGS_DIR, 'conversation.jsonl') },
    { from: join(DATA_DIR, 'lifecycle.jsonl'), to: join(LOGS_DIR, 'lifecycle.jsonl') },

    // PID files: root → pids/
    { from: join(DATA_DIR, 'daemon.pid'), to: join(PIDS_DIR, 'daemon.pid') },
    { from: join(DATA_DIR, 'dashboard.pid'), to: join(PIDS_DIR, 'dashboard.pid') },

    // Consciousness files: root → consciousness/
    {
      from: join(DATA_DIR, 'consciousness.jsonl'),
      to: join(DATA_DIR, 'consciousness', 'consciousness.jsonl'),
    },
    {
      from: join(DATA_DIR, 'reflections.jsonl'),
      to: join(DATA_DIR, 'consciousness', 'reflections.jsonl'),
    },
  ]
}

/** Migrate legacy log/pid paths to new structure. Safe to call repeatedly. */
export function migrateLogPaths(): void {
  try {
    // Ensure target directories exist
    mkdirSync(LOGS_DIR, { recursive: true })
    mkdirSync(PIDS_DIR, { recursive: true })
    mkdirSync(join(DATA_DIR, 'consciousness'), { recursive: true })

    const rules = buildRules()
    let migrated = 0

    for (const rule of rules) {
      if (existsSync(rule.from) && !existsSync(rule.to)) {
        try {
          renameSync(rule.from, rule.to)
          migrated++
          logger.info(`Migrated ${rule.from} → ${rule.to}`)
        } catch (err) {
          logger.warn(`Failed to migrate ${rule.from}: ${err}`)
        }
      }
    }

    // Also migrate old logs/prompts/ if it exists at DATA_DIR/logs/prompts/
    // (this path is already correct, no migration needed)

    if (migrated > 0) {
      logger.info(`Log path migration complete: ${migrated} files moved`)
    }
  } catch (err) {
    logger.warn(`Log path migration failed: ${err}`)
  }
}
