/**
 * Lark card wrapping utilities
 *
 * Converts plain text/markdown into Lark interactive card JSON format.
 * Extracted from larkWsClient.ts to reduce its size and isolate
 * Lark-specific formatting concerns.
 */

/**
 * Convert standard markdown tables to Lark <table> tags
 * Input: | col1 | col2 |\n|---|---|\n| a | b |
 * Output: <table columns={[...]} data={[...]}/>
 */
export function convertMarkdownTables(text: string): string {
  // Match consecutive | lines (at least 3: header + separator + 1 row)
  return text.replace(
    /(?:^|\n)((?:\|[^\n]+\|\n){2,}(?:\|[^\n]+\|))/g,
    (_match, tableBlock: string) => {
      const lines = tableBlock.trim().split('\n')
      if (lines.length < 3) return tableBlock

      const headerCells = lines[0]!
        .split('|')
        .filter(c => c.trim())
        .map(c => c.trim())
      const isSeparator = (line: string) => /^\|[\s\-:]+\|$/.test(line.trim())
      if (!isSeparator(lines[1]!)) return tableBlock

      const dataRows = lines.slice(2).filter(l => !isSeparator(l))
      const columns = headerCells.map(h => ({
        tag: 'plain_text' as const,
        width: 'auto' as const,
        text: h,
      }))
      const data = dataRows.map(row => {
        const cells = row
          .split('|')
          .filter(c => c.trim())
          .map(c => c.trim())
        const obj: Record<string, string> = {}
        headerCells.forEach((h, i) => {
          obj[h] = cells[i] ?? ''
        })
        return obj
      })

      const columnsJson = JSON.stringify(columns)
      const dataJson = JSON.stringify(data)
      return `\n<table columns=${columnsJson} data=${dataJson}/>`
    }
  )
}

/**
 * Normalize markdown for Lark card rendering.
 *
 * Lark card markdown (tag: 'markdown') supports (official docs):
 *   **bold**, *italic*, ~~strikethrough~~, [link](url), emoji, <at>,
 *   <font color>, <text_tag>, ![image](key), \n ---\n (hr),
 *   ordered/unordered lists (7.6+), ```code blocks``` (7.6+)
 *
 * NOT supported (must be converted):
 *   # headings, `inline code`, > blockquote
 */
export function normalizeLarkMarkdown(text: string): string {
  let result = convertMarkdownTables(text)
  // # headings → bold (not supported in card markdown)
  result = result.replace(/^(#{1,})\s+(.+)$/gm, (_match, _hashes: string, title: string) => {
    return `**${title}**`
  })
  // `inline code` → <text_tag> label (not supported natively in card markdown)
  // Must skip triple backticks (code blocks ARE supported since 7.6)
  result = result.replace(/(?<!`)(`)((?!`)[^`]+)\1(?!`)/g, '<text_tag color=\'neutral\'>$2</text_tag>')
  // > blockquote → grey colored text (not supported natively in card markdown)
  result = result.replace(/^>\s?(.*)$/gm, '<font color=\'grey\'>$1</font>')
  return result
}

/**
 * Split text by horizontal rules (---) and build card elements.
 * Each section becomes a markdown element, separated by hr elements.
 */
export function buildMarkdownCard(text: string): string {
  // Split by horizontal rules (---, ***, ___) on their own line
  const sections = text.split(/^(?:---+|\*\*\*+|___+)\s*$/m)
  const elements: Record<string, unknown>[] = []

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!.trim()
    if (section) {
      elements.push({ tag: 'markdown', content: normalizeLarkMarkdown(section) })
    }
    // Add hr between sections (not after the last one)
    if (i < sections.length - 1) {
      elements.push({ tag: 'hr' })
    }
  }

  // Fallback: if no content at all, add empty markdown
  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: text })
  }

  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements,
  })
}
