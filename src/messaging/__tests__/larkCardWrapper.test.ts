import { describe, it, expect } from 'vitest'
import { normalizeLarkMarkdown, buildMarkdownCard } from '../larkCardWrapper.js'

describe('normalizeLarkMarkdown', () => {
  it('converts headings and blockquotes, preserves tables as-is', () => {
    const input = `# Summary

| key | value |
|-----|-------|
| rate | 10% |

> Note: this is a quote`

    const result = normalizeLarkMarkdown(input)
    // Heading → bold
    expect(result).toContain('**Summary**')
    // Table preserved (no longer converted to list)
    expect(result).toContain('| rate | 10% |')
    // Blockquote → grey
    expect(result).toContain('<font color=\'grey\'>Note: this is a quote</font>')
  })

  it('preserves code blocks', () => {
    const input = '```js\nconst x = 1\n```'
    const result = normalizeLarkMarkdown(input)
    expect(result).toContain('```js\nconst x = 1\n```')
  })

  it('converts inline code in table cells to text_tag', () => {
    const input = `| 属性 | 值 |
|------|-----|
| ID | \`task-123\` |
| 状态 | ✅ 已完成 |`

    const result = normalizeLarkMarkdown(input)
    // Table preserved, inline code converted to text_tag
    expect(result).toContain("<text_tag color='neutral'>task-123</text_tag>")
    expect(result).toContain('| 属性 | 值 |')
  })

  it('converts inline code to text_tag', () => {
    const result = normalizeLarkMarkdown('use `npm install` to install')
    expect(result).toContain("<text_tag color='neutral'>npm install</text_tag>")
  })

  it('preserves unordered lists', () => {
    const input = '- item1\n- item2\n- item3'
    const result = normalizeLarkMarkdown(input)
    expect(result).toBe('- item1\n- item2\n- item3')
  })

  it('preserves ordered lists', () => {
    const input = '1. item1\n2. item2\n3. item3'
    const result = normalizeLarkMarkdown(input)
    expect(result).toBe('1. item1\n2. item2\n3. item3')
  })
})

describe('buildMarkdownCard', () => {
  it('handles text with lists and code blocks', () => {
    const input = '**Title**\n\n- item1\n- item2\n\n```js\nconst x = 1\n```'
    const result = JSON.parse(buildMarkdownCard(input))
    expect(result.config.wide_screen_mode).toBe(true)
    expect(result.body.elements).toHaveLength(1)
    expect(result.body.elements[0].tag).toBe('markdown')
    expect(result.body.elements[0].content).toContain('- item1')
    expect(result.body.elements[0].content).toContain('- item2')
    expect(result.body.elements[0].content).toContain('```js\nconst x = 1\n```')
  })

  it('splits sections by horizontal rules', () => {
    const input = 'Section 1\n\n---\n\nSection 2'
    const result = JSON.parse(buildMarkdownCard(input))
    expect(result.body.elements).toHaveLength(3)
    expect(result.body.elements[0].tag).toBe('markdown')
    expect(result.body.elements[1].tag).toBe('hr')
    expect(result.body.elements[2].tag).toBe('markdown')
  })
})
