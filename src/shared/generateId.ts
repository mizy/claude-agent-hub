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

