/**
 * Truncate text with ellipsis
 *
 * Common display lengths:
 * - Title (CLI/Lark): 40
 * - Title (storage): 47
 * - Description/error: 200
 * - Log preview: 60
 */
export function truncateText(text: string, maxLength: number = 40, suffix: string = '...'): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - suffix.length) + suffix
}
