import { describe, it, expect } from 'vitest'
import { convertMarkdownTables, normalizeLarkMarkdown, buildMarkdownCard } from '../larkCardWrapper.js'

describe('convertMarkdownTables', () => {
  it('converts 3+ column table to header + bulleted list format', () => {
    const input = `| 指标 | 值 | 排名 |
|------|-----|------|
| 收益率 | 15.2% | 前10% |
| 回撤 | -5.3% | 前20% |`

    const result = convertMarkdownTables(input)
    expect(result).toBe(
      `**指标** · **值** · **排名**\n` +
      `- 收益率 · 15.2% · 前10%\n` +
      `- 回撤 · -5.3% · 前20%`
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

  it('converts 5-column report table to header + bulleted list', () => {
    const input = `| 节点 | 类型 | 状态 | 耗时 | 成本 |
|------|------|------|------|------|
| GenerateCode | code_gen | ✓ completed | 2m 15s | $0.018 |
| ReviewCode | review | ✓ completed | 1m 30s | $0.005 |
| TestCode | test | ✗ failed | 47s | $0.001 |`

    const result = convertMarkdownTables(input)
    expect(result).toBe(
      `**节点** · **类型** · **状态** · **耗时** · **成本**\n` +
      `- GenerateCode · code_gen · ✓ completed · 2m 15s · $0.018\n` +
      `- ReviewCode · review · ✓ completed · 1m 30s · $0.005\n` +
      `- TestCode · test · ✗ failed · 47s · $0.001`
    )
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

  it('handles single column table', () => {
    const input = `| name |
|------|
| foo |
| bar |`

    const result = convertMarkdownTables(input)
    // Single column: header + list format
    expect(result).toBe('**name**\n- foo\n- bar')
  })

  it('handles cells with bold, links, and Chinese characters', () => {
    const input = `| 名称 | 状态 | 链接 |
|------|------|------|
| **核心模块** | ✅ 已完成 | [查看](https://example.com) |
| 测试套件 | ⏳ 进行中 | [PR#42](https://github.com/pr/42) |`

    const result = convertMarkdownTables(input)
    expect(result).toContain('**名称** · **状态** · **链接**')
    expect(result).toContain('- **核心模块** · ✅ 已完成 · [查看](https://example.com)')
    expect(result).toContain('- 测试套件 · ⏳ 进行中 · [PR#42](https://github.com/pr/42)')
  })

  it('handles multiple tables in the same content', () => {
    const input = `First table:

| key | value |
|-----|-------|
| a | 1 |

Some text between.

| col1 | col2 | col3 |
|------|------|------|
| x | y | z |`

    const result = convertMarkdownTables(input)
    // First table: 2-col key-value
    expect(result).toContain('**a**: 1')
    // Second table: 3-col header + list format
    expect(result).toContain('**col1** · **col2** · **col3**\n- x · y · z')
    expect(result).toContain('Some text between.')
    expect(result).not.toMatch(/\|.*---.*\|/)
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

  it('converts inline code in table cells to text_tag', () => {
    const input = `| 属性 | 值 |
|------|-----|
| ID | \`task-123\` |
| 状态 | ✅ 已完成 |`

    const result = normalizeLarkMarkdown(input)
    // Table converts first, then inline code converts
    expect(result).toContain("**ID**: <text_tag color='neutral'>task-123</text_tag>")
    expect(result).toContain('**状态**: ✅ 已完成')
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
    expect(result.elements).toHaveLength(1)
    expect(result.elements[0].tag).toBe('markdown')
    expect(result.elements[0].content).toContain('- item1')
    expect(result.elements[0].content).toContain('- item2')
    expect(result.elements[0].content).toContain('```js\nconst x = 1\n```')
  })

  it('splits sections by horizontal rules', () => {
    const input = 'Section 1\n\n---\n\nSection 2'
    const result = JSON.parse(buildMarkdownCard(input))
    expect(result.elements).toHaveLength(3)
    expect(result.elements[0].tag).toBe('markdown')
    expect(result.elements[1].tag).toBe('hr')
    expect(result.elements[2].tag).toBe('markdown')
  })
})
