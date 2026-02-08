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

/** Wrap text into a Lark markdown interactive card JSON string */
export function buildMarkdownCard(text: string): string {
  const content = convertMarkdownTables(text)
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [{ tag: 'markdown', content }],
  })
}
