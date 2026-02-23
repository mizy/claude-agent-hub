/**
 * Resolve evolution context for the current working directory
 *
 * Detects whether cwd is the CAH project itself or an external project,
 * and reads project configuration if available.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface EvolveContext {
  isCAH: boolean
  projectName?: string
  projectType?: string
  configPath?: string
  cwd: string
}

/** Detect project context from cwd */
export function resolveEvolveContext(cwd?: string): EvolveContext {
  const dir = cwd ?? process.cwd()

  // Check if this is the CAH project
  const pkgPath = join(dir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.name === '@mizy/claude-agent-hub' || pkg.name === 'claude-agent-hub') {
        return { isCAH: true, projectName: pkg.name, cwd: dir }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Fallback: check for src/selfevolve directory (CAH signature)
  if (existsSync(join(dir, 'src/selfevolve'))) {
    return { isCAH: true, projectName: 'claude-agent-hub', cwd: dir }
  }

  // Check for external project config
  const configPath = join(dir, '.claude-agent-hub.yaml')
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8')
      // Simple YAML extraction for name/type fields
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      const typeMatch = content.match(/^type:\s*(.+)$/m)
      return {
        isCAH: false,
        projectName: nameMatch?.[1]?.trim(),
        projectType: typeMatch?.[1]?.trim(),
        configPath,
        cwd: dir,
      }
    } catch {
      return { isCAH: false, configPath, cwd: dir }
    }
  }

  // Try to get project name from package.json even if not CAH
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return { isCAH: false, projectName: pkg.name, cwd: dir }
    } catch {
      // Ignore
    }
  }

  return { isCAH: false, cwd: dir }
}
