/**
 * builtinAgents tests
 * Tests agent data integrity and lookup functions
 */

import { describe, it, expect } from 'vitest'
import { BUILTIN_AGENTS, getBuiltinAgent, getAvailableAgents } from '../builtinAgents.js'

describe('BUILTIN_AGENTS', () => {
  it('should contain expected agents', () => {
    const names = Object.keys(BUILTIN_AGENTS)
    expect(names).toContain('Pragmatist')
    expect(names).toContain('Architect')
    expect(names).toContain('Tester')
    expect(names).toContain('Reviewer')
    expect(names).toContain('None')
    expect(names).toContain('Debugger')
    expect(names).toContain('Product')
    expect(names).toContain('Documenter')
    expect(names).toContain('Optimizer')
    expect(names).toContain('Mentor')
    // 15 total: None + 14 named agents
    expect(names.length).toBe(15)
  })

  it('should have valid structure for all agents', () => {
    for (const [name, agent] of Object.entries(BUILTIN_AGENTS)) {
      expect(agent.name, `${name} should have name`).toBe(name)
      expect(agent.description, `${name} should have description`).toBeTruthy()
      expect(agent.traits, `${name} should have traits`).toBeDefined()
      expect(agent.preferences, `${name} should have preferences`).toBeDefined()
      expect(typeof agent.systemPrompt, `${name} systemPrompt should be string`).toBe('string')
    }
  })

  it('None agent should have empty system prompt', () => {
    const none = getBuiltinAgent('None')
    expect(none).toBeDefined()
    expect(none!.systemPrompt).toBe('')
  })

  it('non-None agents should have non-empty system prompts', () => {
    for (const [name, agent] of Object.entries(BUILTIN_AGENTS)) {
      if (name !== 'None') {
        expect(agent.systemPrompt.length, `${name} prompt should be non-empty`).toBeGreaterThan(0)
      }
    }
  })
})

describe('getBuiltinAgent', () => {
  it('should return agent by exact name', () => {
    const agent = getBuiltinAgent('Pragmatist')
    expect(agent).toBeDefined()
    expect(agent!.name).toBe('Pragmatist')
  })

  it('should return undefined for unknown agent', () => {
    expect(getBuiltinAgent('NonExistent')).toBeUndefined()
  })

  it('should be case-sensitive', () => {
    expect(getBuiltinAgent('pragmatist')).toBeUndefined()
    expect(getBuiltinAgent('PRAGMATIST')).toBeUndefined()
  })
})

describe('getAvailableAgents', () => {
  it('should return all agent names', () => {
    const names = getAvailableAgents()
    expect(names).toEqual(Object.keys(BUILTIN_AGENTS))
  })

  it('should return array of strings', () => {
    const names = getAvailableAgents()
    expect(Array.isArray(names)).toBe(true)
    for (const name of names) {
      expect(typeof name).toBe('string')
    }
  })
})
