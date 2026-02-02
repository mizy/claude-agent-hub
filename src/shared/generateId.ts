/**
 * ID 生成工具
 * 使用 crypto.randomUUID，支持短 ID
 */

import { randomUUID } from 'crypto'

// 生成完整 UUID
export function generateId(): string {
  return randomUUID()
}

// 生成短 ID (8字符)
export function generateShortId(): string {
  return randomUUID().slice(0, 8)
}

// 验证 UUID 格式
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

// 缩短 UUID 用于显示
export function shortenId(id: string, length: number = 8): string {
  return id.slice(0, length)
}

// 匹配短 ID（前缀匹配）
export function matchesShortId(fullId: string, shortId: string): boolean {
  return fullId.toLowerCase().startsWith(shortId.toLowerCase())
}
