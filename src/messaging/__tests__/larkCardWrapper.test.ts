import { describe, it, expect } from 'vitest'
import { convertMarkdownTables, normalizeLarkMarkdown } from '../larkCardWrapper.js'

describe('convertMarkdownTables', () => {
  it('converts 3+ column table to key-value list format', () => {
    const input = `| 指标 | 值 | 排名 |
|------|-----|------|
| 收益率 | 15.2% | 前10% |
| 回撤 | -5.3% | 前20% |`

    const result = convertMarkdownTables(input)
    expect(result).toBe(
      `**指标**: 收益率 / **值**: 15.2% / **排名**: 前10%\n` +
      `**指标**: 回撤 / **值**: -5.3% / **排名**: 前20%`
    )
  })

  it('converts 2-column table to simple key-value format', () => {
    const input = `| 名称 | 值 |
|------|-----|
| 收益率 | 15.2% |
| 回撤 | -5.3% |`

    const result = convertMarkdownTables(input)
    expect(result).toBe(
      `**收益率**: 15.2%\n**回撤**: -5.3%`
    )
  })

  it('preserves surrounding text', () => {
    const input = `Some text before

| col1 | col2 |
|------|------|
| a | b |

Some text after`

    const result = convertMarkdownTables(input)
    expect(result).toContain('Some text before')
    expect(result).toContain('Some text after')
    expect(result).toContain('**a**: b')
    expect(result).not.toContain('|')
  })

  it('returns original text when no separator row', () => {
    const input = `| col1 | col2 |
| a | b |
| c | d |`

    const result = convertMarkdownTables(input)
    // No separator → not a valid table → keep original
    expect(result).toBe(input)
  })

  it('returns original text when only header and separator (no data rows)', () => {
    const input = `| col1 | col2 |
|------|------|`

    // Only 2 lines, regex requires at least 3 consecutive | lines
    const result = convertMarkdownTables(input)
    expect(result).toBe(input)
  })

  it('handles table with header + separator + empty-ish data', () => {
    const input = `| col1 | col2 |
|------|------|
|  |  |`

    const result = convertMarkdownTables(input)
    // Empty cells should still convert
    expect(result).not.toContain('<table')
  })

  it('handles single data row', () => {
    const input = `| name | value |
|------|-------|
| foo | bar |`

    const result = convertMarkdownTables(input)
    expect(result).toBe('**foo**: bar')
  })

  it('handles table embedded in markdown text', () => {
    const input = `Here is a summary:

| 指标 | 值 |
|------|-----|
| alpha | 0.5 |

And some conclusion.`

    const result = convertMarkdownTables(input)
    expect(result).toContain('**alpha**: 0.5')
    expect(result).toContain('Here is a summary:')
    expect(result).toContain('And some conclusion.')
  })
})

describe('normalizeLarkMarkdown', () => {
  it('converts tables before other transformations', () => {
    const input = `# Summary

| key | value |
|-----|-------|
| rate | 10% |

> Note: this is a quote`

    const result = normalizeLarkMarkdown(input)
    // Heading → bold
    expect(result).toContain('**Summary**')
    // Table → key-value
    expect(result).toContain('**rate**: 10%')
    // Blockquote → grey
    expect(result).toContain('<font color=\'grey\'>Note: this is a quote</font>')
    // No raw table syntax
    expect(result).not.toMatch(/\|.*\|.*\|/)
  })

  it('preserves code blocks', () => {
    const input = '```js\nconst x = 1\n```'
    const result = normalizeLarkMarkdown(input)
    expect(result).toContain('```js\nconst x = 1\n```')
  })

  it('converts inline code to text_tag', () => {
    const result = normalizeLarkMarkdown('use `npm install` to install')
    expect(result).toContain("<text_tag color='neutral'>npm install</text_tag>")
  })
})
