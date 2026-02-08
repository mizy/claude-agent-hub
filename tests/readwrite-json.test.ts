/**
 * readWriteJson 测试
 *
 * 覆盖:
 * - readJson: 读取、默认值、校验
 * - writeJson: 原子写入、目录自动创建
 * - appendToFile: 追加写入
 * - ensureDir / ensureDirs: 目录创建
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readJson, writeJson, appendToFile, ensureDir, ensureDirs } from '../src/store/readWriteJson.js'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'cah-rw-test-'))
})

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

describe('readJson', () => {
  it('should read valid JSON file', () => {
    const filepath = join(testDir, 'data.json')
    writeFileSync(filepath, JSON.stringify({ key: 'value' }))

    const result = readJson<{ key: string }>(filepath)
    expect(result).toEqual({ key: 'value' })
  })

  it('should return null for non-existent file', () => {
    const result = readJson(join(testDir, 'nonexistent.json'))
    expect(result).toBeNull()
  })

  it('should return defaultValue for non-existent file', () => {
    const result = readJson(join(testDir, 'nonexistent.json'), {
      defaultValue: { fallback: true },
    })
    expect(result).toEqual({ fallback: true })
  })

  it('should return null for invalid JSON', () => {
    const filepath = join(testDir, 'bad.json')
    writeFileSync(filepath, 'not valid json {{{')

    const result = readJson(filepath)
    expect(result).toBeNull()
  })

  it('should return defaultValue for invalid JSON', () => {
    const filepath = join(testDir, 'bad.json')
    writeFileSync(filepath, 'not valid json')

    const result = readJson(filepath, { defaultValue: [] })
    expect(result).toEqual([])
  })

  it('should run validate callback', () => {
    const filepath = join(testDir, 'data.json')
    writeFileSync(filepath, JSON.stringify({ count: 5 }))

    // Passing validation
    const valid = readJson<{ count: number }>(filepath, {
      validate: (d) => typeof d === 'object' && d !== null && 'count' in d,
    })
    expect(valid).toEqual({ count: 5 })

    // Failing validation
    const invalid = readJson(filepath, {
      validate: () => false,
      defaultValue: null,
    })
    expect(invalid).toBeNull()
  })
})

describe('writeJson', () => {
  it('should write JSON with default indent', () => {
    const filepath = join(testDir, 'out.json')
    writeJson(filepath, { hello: 'world' })

    const content = readFileSync(filepath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ hello: 'world' })
    // Default indent is 2
    expect(content).toContain('  "hello"')
  })

  it('should use atomic write by default (no .tmp left behind)', () => {
    const filepath = join(testDir, 'atomic.json')
    writeJson(filepath, { data: 1 })

    expect(existsSync(filepath)).toBe(true)
    expect(existsSync(filepath + '.tmp')).toBe(false)
  })

  it('should support non-atomic write', () => {
    const filepath = join(testDir, 'direct.json')
    writeJson(filepath, { data: 2 }, { atomic: false })

    expect(existsSync(filepath)).toBe(true)
    expect(JSON.parse(readFileSync(filepath, 'utf-8'))).toEqual({ data: 2 })
  })

  it('should create parent directories', () => {
    const filepath = join(testDir, 'deep', 'nested', 'file.json')
    writeJson(filepath, { nested: true })

    expect(existsSync(filepath)).toBe(true)
    expect(JSON.parse(readFileSync(filepath, 'utf-8'))).toEqual({ nested: true })
  })

  it('should support custom indent', () => {
    const filepath = join(testDir, 'indent.json')
    writeJson(filepath, { x: 1 }, { indent: 4 })

    const content = readFileSync(filepath, 'utf-8')
    expect(content).toContain('    "x"')
  })

  it('should overwrite existing file', () => {
    const filepath = join(testDir, 'overwrite.json')
    writeJson(filepath, { v: 1 })
    writeJson(filepath, { v: 2 })

    expect(JSON.parse(readFileSync(filepath, 'utf-8'))).toEqual({ v: 2 })
  })
})

describe('appendToFile', () => {
  it('should append content to existing file', () => {
    const filepath = join(testDir, 'log.txt')
    writeFileSync(filepath, 'line1\n')
    appendToFile(filepath, 'line2\n')

    expect(readFileSync(filepath, 'utf-8')).toBe('line1\nline2\n')
  })

  it('should create file if not exists', () => {
    const filepath = join(testDir, 'new.txt')
    appendToFile(filepath, 'first\n')

    expect(readFileSync(filepath, 'utf-8')).toBe('first\n')
  })

  it('should create parent directories', () => {
    const filepath = join(testDir, 'logs', 'deep', 'file.txt')
    appendToFile(filepath, 'data')

    expect(existsSync(filepath)).toBe(true)
  })
})

describe('ensureDir', () => {
  it('should create directory if not exists', () => {
    const dir = join(testDir, 'newdir')
    expect(existsSync(dir)).toBe(false)

    ensureDir(dir)
    expect(existsSync(dir)).toBe(true)
  })

  it('should not throw if directory already exists', () => {
    const dir = join(testDir, 'existing')
    mkdirSync(dir)

    expect(() => ensureDir(dir)).not.toThrow()
  })

  it('should create nested directories', () => {
    const dir = join(testDir, 'a', 'b', 'c')
    ensureDir(dir)

    expect(existsSync(dir)).toBe(true)
  })
})

describe('ensureDirs', () => {
  it('should create multiple directories', () => {
    const dir1 = join(testDir, 'dir1')
    const dir2 = join(testDir, 'dir2')
    const dir3 = join(testDir, 'dir3')

    ensureDirs(dir1, dir2, dir3)

    expect(existsSync(dir1)).toBe(true)
    expect(existsSync(dir2)).toBe(true)
    expect(existsSync(dir3)).toBe(true)
  })
})
