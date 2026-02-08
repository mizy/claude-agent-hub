/**
 * Shared constants for notify handlers and adapters
 *
 * Extracted from commandHandler.ts and buildLarkCard.ts to eliminate duplication.
 * Also includes command sets previously duplicated in larkWsClient.ts and telegramClient.ts.
 */

// ── Status emoji mapping ──

export const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳',
  planning: '📋',
  developing: '🔨',
  reviewing: '👀',
  completed: '✅',
  failed: '❌',
  cancelled: '🚫',
}

export function statusEmoji(status: string): string {
  return STATUS_EMOJI[status] || '❓'
}

// ── Command classification sets ──

export const APPROVAL_COMMANDS = new Set([
  '/approve',
  '/通过',
  '/批准',
  '/reject',
  '/拒绝',
  '/否决',
])

export const TASK_COMMANDS = new Set([
  '/run',
  '/list',
  '/logs',
  '/stop',
  '/resume',
  '/get',
  '/help',
  '/status',
])
