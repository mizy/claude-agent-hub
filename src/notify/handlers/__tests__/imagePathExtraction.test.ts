import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Copy the extraction logic for testing
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

function extractImagePaths(text: string): string[] {
  const { resolve, isAbsolute } = require('path')
  const { existsSync } = require('fs')

  const paths: string[] = []

  // Pattern 1: Absolute paths (/path/to/image.png)
  const absoluteRegex = /(?:^|\s|["'`])(\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$|["'`)\]},;:])/gim
  let match: RegExpExecArray | null
  while ((match = absoluteRegex.exec(text)) !== null) {
    const filePath = match[1]!
    if (existsSync(filePath)) paths.push(filePath)
  }

  // Pattern 2: Markdown image syntax ![alt](path)
  const markdownRegex = /!\[.*?\]\(([\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))\)/gi
  while ((match = markdownRegex.exec(text)) !== null) {
    const filePath = match[1]!
    const resolved = resolveImagePath(filePath)
    if (resolved && existsSync(resolved)) paths.push(resolved)
  }

  // Pattern 3: Relative paths mentioned in text (./image.png or image.png)
  const relativeRegex = /(?:^|\s|["'`])(\.?\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp)|[\w-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$|["'`)\]},;:])/gim
  while ((match = relativeRegex.exec(text)) !== null) {
    const filePath = match[1]!
    const resolved = resolveImagePath(filePath)
    if (resolved && existsSync(resolved)) paths.push(resolved)
  }

  return [...new Set(paths)] // dedupe

  function resolveImagePath(path: string): string | null {
    if (isAbsolute(path)) return path

    // Try cwd
    const cwdPath = resolve(process.cwd(), path)
    if (existsSync(cwdPath)) return cwdPath

    // Try common temp directories
    const tempDirs = ['/tmp', '/var/tmp', process.env.TMPDIR || ''].filter(Boolean)
    for (const dir of tempDirs) {
      const fullPath = resolve(dir, path)
      if (existsSync(fullPath)) return fullPath
    }

    return null
  }
}

describe('Image Path Extraction', () => {
  let tempDir: string
  let testImages: string[]

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cah-test-'))
    testImages = [
      join(tempDir, 'screenshot.png'),
      join(tempDir, 'screenshot-123.png'),
      join(tempDir, 'test-image.jpg'),
    ]
    for (const img of testImages) {
      writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47])) // PNG header
    }
  })

  afterAll(() => {
    for (const img of testImages) {
      try {
        unlinkSync(img)
      } catch {}
    }
  })

  it('should extract absolute paths', () => {
    const text = `Screenshot saved to ${testImages[0]}`
    const paths = extractImagePaths(text)
    expect(paths).toContain(testImages[0])
  })

  it('should extract markdown image syntax', () => {
    const text = `![Screenshot](${testImages[1]})`
    const paths = extractImagePaths(text)
    expect(paths).toContain(testImages[1])
  })

  it('should extract relative paths from /tmp', () => {
    const relativePath = testImages[0].replace(/^\/tmp\//, '')
    const text = `Saved as ${relativePath}`
    const paths = extractImagePaths(text)
    expect(paths.length).toBeGreaterThan(0)
  })

  it('should extract paths in backticks', () => {
    const text = `Image: \`${testImages[2]}\``
    const paths = extractImagePaths(text)
    expect(paths).toContain(testImages[2])
  })

  it('should deduplicate paths', () => {
    const text = `${testImages[0]} and ${testImages[0]} again`
    const paths = extractImagePaths(text)
    expect(paths.filter(p => p === testImages[0])).toHaveLength(1)
  })

  it('should ignore non-existent files', () => {
    const text = 'Screenshot at /non/existent/file.png'
    const paths = extractImagePaths(text)
    expect(paths).not.toContain('/non/existent/file.png')
  })
})
