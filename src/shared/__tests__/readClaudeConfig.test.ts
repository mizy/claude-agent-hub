/**
 * Tests for readClaudeConfig module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'

// Mock fs before importing the module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  }
})

import { existsSync, readFileSync, readdirSync } from 'fs'
import {
  readGlobalClaudeMd,
  readProjectClaudeMd,
  readProjectMemory,
  readAllSkills,
  buildClaudeSystemPrompt,
} from '../readClaudeConfig.js'

const CLAUDE_DIR = join(homedir(), '.claude')
const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockReaddirSync = vi.mocked(readdirSync)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readGlobalClaudeMd', () => {
  it('should read ~/.claude/CLAUDE.md when it exists', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('# Global instructions')

    const result = readGlobalClaudeMd()

    expect(result).toBe('# Global instructions')
    expect(mockExistsSync).toHaveBeenCalledWith(join(CLAUDE_DIR, 'CLAUDE.md'))
    expect(mockReadFileSync).toHaveBeenCalledWith(join(CLAUDE_DIR, 'CLAUDE.md'), 'utf-8')
  })

  it('should return null when file does not exist', () => {
    mockExistsSync.mockReturnValue(false)

    const result = readGlobalClaudeMd()

    expect(result).toBeNull()
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('should return null on read error', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })

    const result = readGlobalClaudeMd()

    expect(result).toBeNull()
  })
})

describe('readProjectClaudeMd', () => {
  it('should read CLAUDE.md from project path', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('# Project instructions')

    const result = readProjectClaudeMd('/Users/test/my-project')

    expect(result).toBe('# Project instructions')
    expect(mockExistsSync).toHaveBeenCalledWith('/Users/test/my-project/CLAUDE.md')
  })

  it('should return null when project CLAUDE.md does not exist', () => {
    mockExistsSync.mockReturnValue(false)

    const result = readProjectClaudeMd('/nonexistent/path')

    expect(result).toBeNull()
  })
})

describe('readProjectMemory', () => {
  it('should use path hash to locate memory file', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('# Memory content')

    const result = readProjectMemory('/Users/miaozhuang/projects/foo')

    expect(result).toBe('# Memory content')
    expect(mockExistsSync).toHaveBeenCalledWith(
      join(CLAUDE_DIR, 'projects', '-Users-miaozhuang-projects-foo', 'memory', 'MEMORY.md')
    )
  })

  it('should return null when memory file does not exist', () => {
    mockExistsSync.mockReturnValue(false)

    const result = readProjectMemory('/some/project')

    expect(result).toBeNull()
  })
})

describe('readAllSkills', () => {
  it('should parse skills with YAML frontmatter', () => {
    // Skills dir exists
    mockExistsSync.mockReturnValue(true)

    // List skill directories
    mockReaddirSync.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr === join(CLAUDE_DIR, 'skills')) {
        return [
          { name: 'my-skill', isDirectory: () => true },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      // Files inside skill directory
      if (pathStr.includes('my-skill')) {
        return ['SKILL.md'] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockReadFileSync.mockReturnValue(
      '---\nname: My Skill\ndescription: Does things\n---\nSkill content here'
    )

    const result = readAllSkills()

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('My Skill')
    expect(result[0]!.description).toBe('Does things')
    expect(result[0]!.content).toBe('Skill content here')
  })

  it('should return empty array when skills dir does not exist', () => {
    mockExistsSync.mockReturnValue(false)

    const result = readAllSkills()

    expect(result).toEqual([])
  })

  it('should fallback to dir name when frontmatter has no name', () => {
    mockExistsSync.mockReturnValue(true)

    mockReaddirSync.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr === join(CLAUDE_DIR, 'skills')) {
        return [{ name: 'fallback-skill', isDirectory: () => true }] as unknown as ReturnType<typeof readdirSync>
      }
      if (pathStr.includes('fallback-skill')) {
        return ['SKILL.md'] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockReadFileSync.mockReturnValue('---\ndescription: A skill\n---\nBody')

    const result = readAllSkills()

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('fallback-skill')
  })

  it('should skip non-directory entries', () => {
    mockExistsSync.mockReturnValue(true)

    mockReaddirSync.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr === join(CLAUDE_DIR, 'skills')) {
        return [
          { name: 'readme.md', isDirectory: () => false },
          { name: 'real-skill', isDirectory: () => true },
        ] as unknown as ReturnType<typeof readdirSync>
      }
      if (pathStr.includes('real-skill')) {
        return ['SKILL.md'] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockReadFileSync.mockReturnValue('---\nname: Real\n---\ncontent')

    const result = readAllSkills()

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Real')
  })

  it('should find SKILL.md case-insensitively', () => {
    mockExistsSync.mockReturnValue(true)

    mockReaddirSync.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr === join(CLAUDE_DIR, 'skills')) {
        return [{ name: 'lower-case', isDirectory: () => true }] as unknown as ReturnType<typeof readdirSync>
      }
      if (pathStr.includes('lower-case')) {
        return ['skill.md'] as unknown as ReturnType<typeof readdirSync>  // lowercase
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    mockReadFileSync.mockReturnValue('---\nname: Lower\n---\nbody')

    const result = readAllSkills()

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Lower')
  })
})

describe('buildClaudeSystemPrompt', () => {
  it('should assemble prompt from all sources', () => {
    // existsSync: all files exist
    mockExistsSync.mockReturnValue(true)

    // readFileSync calls for global, project, memory
    let callCount = 0
    mockReadFileSync.mockImplementation(() => {
      callCount++
      if (callCount === 1) return 'Global rules'
      if (callCount === 2) return 'Project rules'
      if (callCount === 3) return 'Memory notes'
      return ''
    })

    // No skills dir entries (readAllSkills will call readdirSync)
    mockReaddirSync.mockImplementation((path: unknown) => {
      const pathStr = String(path)
      if (pathStr === join(CLAUDE_DIR, 'skills')) {
        return [] as unknown as ReturnType<typeof readdirSync>
      }
      return [] as unknown as ReturnType<typeof readdirSync>
    })

    const result = buildClaudeSystemPrompt({ projectPath: '/my/project' })

    expect(result).toContain('Global rules')
    expect(result).toContain('Project rules')
    expect(result).toContain('Memory notes')
    expect(result).toContain('---')
  })

  it('should work with no options (global only)', () => {
    mockExistsSync.mockImplementation((path: unknown) => {
      return String(path) === join(CLAUDE_DIR, 'CLAUDE.md')
    })
    mockReadFileSync.mockReturnValue('Global only')
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>)

    const result = buildClaudeSystemPrompt()

    expect(result).toContain('Global only')
    expect(result).not.toContain('Project')
  })

  it('should skip memory when includeMemory is false', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('content')
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>)

    const result = buildClaudeSystemPrompt({
      projectPath: '/proj',
      includeMemory: false,
    })

    // Should have global + project but not memory section
    expect(result).toContain('Global Instructions')
    expect(result).toContain('Project Instructions')
    expect(result).not.toContain('Project Memory')
  })

  it('should skip skills when includeSkills is false', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('content')

    const result = buildClaudeSystemPrompt({
      includeSkills: false,
    })

    expect(result).not.toContain('Available Skills')
    // readdirSync should not be called for skills
    expect(mockReaddirSync).not.toHaveBeenCalled()
  })

  it('should return empty string when nothing is found', () => {
    mockExistsSync.mockReturnValue(false)
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>)

    const result = buildClaudeSystemPrompt()

    expect(result).toBe('')
  })
})
