/**
 * Read Claude Code configuration context (CLAUDE.md, memory, skills)
 *
 * Provides functions to read Claude's various config files and assemble
 * them into a system prompt for OpenAI-compatible backends.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import matter from 'gray-matter'
import { createLogger } from './logger.js'

const log = createLogger('readClaudeConfig')

const CLAUDE_DIR = join(homedir(), '.claude')

export interface SkillEntry {
  name: string
  description: string
  content: string
}

/** Read ~/.claude/CLAUDE.md */
export function readGlobalClaudeMd(): string | null {
  const filePath = join(CLAUDE_DIR, 'CLAUDE.md')
  return readFileSafe(filePath)
}

/** Read <projectPath>/CLAUDE.md (project-local instructions) */
export function readProjectClaudeMd(projectPath: string): string | null {
  const filePath = join(projectPath, 'CLAUDE.md')
  return readFileSafe(filePath)
}

/**
 * Read project-specific memory from ~/.claude/projects/<hash>/memory/MEMORY.md
 *
 * Hash rule: absolute path with '/' replaced by '-'
 * e.g. /Users/miaozhuang/projects/foo → -Users-miaozhuang-projects-foo
 */
export function readProjectMemory(projectPath: string): string | null {
  const hash = projectPath.replaceAll('/', '-')
  const filePath = join(CLAUDE_DIR, 'projects', hash, 'memory', 'MEMORY.md')
  return readFileSafe(filePath)
}

/** Read all skills from ~/.claude/skills/{name}/SKILL.md (case-insensitive) */
export function readAllSkills(): SkillEntry[] {
  const skillsDir = join(CLAUDE_DIR, 'skills')
  if (!existsSync(skillsDir)) return []

  const entries: SkillEntry[] = []
  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue

      // Find SKILL.md case-insensitively (some dirs use skill.md)
      const dirPath = join(skillsDir, dir.name)
      const files = readdirSync(dirPath)
      const skillFile = files.find((f) => f.toLowerCase() === 'skill.md')
      if (!skillFile) continue

      const raw = readFileSafe(join(dirPath, skillFile))
      if (!raw) continue

      try {
        const { data, content } = matter(raw)
        entries.push({
          name: data.name || dir.name,
          description: data.description || '',
          content: content.trim(),
        })
      } catch {
        log.warn(`Failed to parse frontmatter in ${dir.name}/SKILL.md`)
        entries.push({ name: dir.name, description: '', content: raw.trim() })
      }
    }
  } catch {
    log.warn('Failed to read skills directory')
  }

  return entries
}

export interface BuildSystemPromptOptions {
  projectPath?: string
  includeSkills?: boolean
  includeMemory?: boolean
}

/** Assemble a full system prompt from Claude config sources */
export function buildClaudeSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const { projectPath, includeSkills = true, includeMemory = true } = options
  const parts: string[] = []

  // Global CLAUDE.md
  const globalMd = readGlobalClaudeMd()
  if (globalMd) {
    parts.push(`# Global Instructions\n\n${globalMd}`)
  }

  // Project CLAUDE.md
  if (projectPath) {
    const projectMd = readProjectClaudeMd(projectPath)
    if (projectMd) {
      parts.push(`# Project Instructions\n\n${projectMd}`)
    }
  }

  // Project memory
  if (includeMemory && projectPath) {
    const memory = readProjectMemory(projectPath)
    if (memory) {
      parts.push(`# Project Memory\n\n${memory}`)
    }
  }

  // Skills
  if (includeSkills) {
    const skills = readAllSkills()
    if (skills.length > 0) {
      const skillList = skills
        .map((s) => `- **${s.name}**: ${s.description}`)
        .join('\n')
      parts.push(`# Available Skills\n\n${skillList}`)
    }
  }

  return parts.join('\n\n---\n\n')
}

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf-8')
  } catch (e) {
    log.debug(`Failed to read ${filePath}: ${e}`)
    return null
  }
}
