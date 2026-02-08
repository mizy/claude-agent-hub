/**
 * builtinPersonas tests
 * Tests persona data integrity and lookup functions
 */

import { describe, it, expect } from 'vitest'
import { BUILTIN_PERSONAS, getBuiltinPersona, getAvailablePersonas } from '../builtinPersonas.js'

describe('BUILTIN_PERSONAS', () => {
  it('should contain expected personas', () => {
    const names = Object.keys(BUILTIN_PERSONAS)
    expect(names).toContain('Pragmatist')
    expect(names).toContain('Architect')
    expect(names).toContain('Tester')
    expect(names).toContain('Reviewer')
    expect(names).toContain('None')
    expect(names.length).toBeGreaterThanOrEqual(5)
  })

  it('should have valid structure for all personas', () => {
    for (const [name, persona] of Object.entries(BUILTIN_PERSONAS)) {
      expect(persona.name, `${name} should have name`).toBe(name)
      expect(persona.description, `${name} should have description`).toBeTruthy()
      expect(persona.traits, `${name} should have traits`).toBeDefined()
      expect(persona.preferences, `${name} should have preferences`).toBeDefined()
      expect(typeof persona.systemPrompt, `${name} systemPrompt should be string`).toBe('string')
    }
  })

  it('None persona should have empty system prompt', () => {
    const none = getBuiltinPersona('None')
    expect(none).toBeDefined()
    expect(none!.systemPrompt).toBe('')
  })

  it('non-None personas should have non-empty system prompts', () => {
    for (const [name, persona] of Object.entries(BUILTIN_PERSONAS)) {
      if (name !== 'None') {
        expect(persona.systemPrompt.length, `${name} prompt should be non-empty`).toBeGreaterThan(0)
      }
    }
  })
})

describe('getBuiltinPersona', () => {
  it('should return persona by exact name', () => {
    const persona = getBuiltinPersona('Pragmatist')
    expect(persona).toBeDefined()
    expect(persona!.name).toBe('Pragmatist')
  })

  it('should return undefined for unknown persona', () => {
    expect(getBuiltinPersona('NonExistent')).toBeUndefined()
  })

  it('should be case-sensitive', () => {
    expect(getBuiltinPersona('pragmatist')).toBeUndefined()
    expect(getBuiltinPersona('PRAGMATIST')).toBeUndefined()
  })
})

describe('getAvailablePersonas', () => {
  it('should return all persona names', () => {
    const names = getAvailablePersonas()
    expect(names).toEqual(Object.keys(BUILTIN_PERSONAS))
  })

  it('should return array of strings', () => {
    const names = getAvailablePersonas()
    expect(Array.isArray(names)).toBe(true)
    for (const name of names) {
      expect(typeof name).toBe('string')
    }
  })
})
