/**
 * Lark card wrapping utilities
 *
 * Converts plain text/markdown into Lark interactive card JSON format.
 * Extracted from larkWsClient.ts to reduce its size and isolate
 * Lark-specific formatting concerns.
 */

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
  let result = text
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
 * Convert markdown text to Lark post rich text content JSON string.
 *
 * Uses the `md` tag (Lark post format's native Markdown support), which handles:
 *   **bold**, *italic*, ~~strikethrough~~, ~underline~, [link](url),
 *   ``` code blocks ```, > blockquotes, \n --- \n dividers,
 *   ordered/unordered lists, @ mentions
 *
 * Transformations applied before passing to md tag:
 *   - # headings          → **heading** (md tag doesn't support # syntax)
 *   - - [x] task          → - ✅ task
 *   - - [ ] task          → - ☐ task
 *   - `inline code`       → plain text (no native inline code in post md)
 *   - --- hr              → \n ---\n (md tag requires surrounding newlines)
 *
 * Returns JSON.stringify({ zh_cn: { content: [[mdElement]] } }) for msg_type: 'post'.
 */
export function markdownToPostContent(text: string): string {
  // Strip Lark card-specific tags (not valid in post format)
  let result = text
  result = result.replace(/<text_tag[^>]*>([\s\S]*?)<\/text_tag>/g, '$1')
  result = result.replace(/<font[^>]*>([\s\S]*?)<\/font>/g, '$1')

  // # headings → **heading** (md tag doesn't support # headings)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '**$1**')

  // Task lists: - [x] → ✅, - [ ] → ☐
  result = result.replace(/^(\s*)[*-]\s+\[x\]\s*/gim, '$1- ✅ ')
  result = result.replace(/^(\s*)[*-]\s+\[ \]\s*/gim, '$1- ☐ ')

  // Inline code: strip backticks, keep content (no native inline code in post md tag)
  // Must not match triple backticks (code blocks are supported)
  result = result.replace(/(?<!`)`([^`\n]+)`(?!`)/g, '$1')

  // Horizontal rules: md tag requires \n --- \n (with surrounding newlines)
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, '\n ---')

  return JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: result.trim() }]] } })
}

/**
 * Normalize markdown for JSON 2.0 card rendering.
 * JSON 2.0 natively supports: tables, # headings, code blocks, lists, bold, italic, etc.
 * Still need to convert: `inline code` → <text_tag>, > blockquote → grey font
 */
function normalizeLarkCardV2(text: string): string {
  let result = text
  // `inline code` → <text_tag> (skip triple backticks)
  result = result.replace(/(?<!`)(`)((?!`)[^`]+)\1(?!`)/g, '<text_tag color=\'neutral\'>$2</text_tag>')
  // > blockquote → grey colored text
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
      elements.push({ tag: 'markdown', content: normalizeLarkCardV2(section) })
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
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: { elements },
  })
}
