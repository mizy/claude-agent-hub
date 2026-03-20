/**
 * System Prompt Writer
 *
 * 将全局 system prompt 写入各 CLI 工具的配置目录。
 * 支持 opencode、iflow、qwen-code 三种后端。
 *
 * 配置文件位置：
 * - opencode: ~/.config/opencode/opencode.md
 * - iflow: ~/.iflow/IFLOW.md
 * - qwen-code: ~/.qwen/QWEN.md
 */

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from '../shared/logger.js'
import { getErrorMessage } from '../shared/assertError.js'

const logger = createLogger('system-prompt-writer')

/** Content hash cache per file path — skip write if content unchanged */
const contentHashCache = new Map<string, string>()

function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

/** CLI 配置目录路径 */
const CONFIG_PATHS = {
  opencode: join(homedir(), '.config', 'opencode'),
  iflow: join(homedir(), '.iflow'),
  qwen: join(homedir(), '.qwen'),
}

/** 配置文件名 */
const CONFIG_FILES = {
  opencode: 'opencode.md',
  iflow: 'IFLOW.md',
  qwen: 'QWEN.md',
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  } catch (e) {
    logger.error(`Failed to create directory ${dir}: ${getErrorMessage(e)}`)
    throw e
  }
}

/**
 * 写入 opencode 全局 system prompt
 * 路径: ~/.config/opencode/opencode.md
 */
export function writeOpencodeSystemPrompt(systemPrompt: string): void {
  const dir = CONFIG_PATHS.opencode
  const file = join(dir, CONFIG_FILES.opencode)

  try {
    ensureDir(dir)

    if (systemPrompt) {
      // Skip write if content unchanged (system prompt is now static, rarely changes)
      const hash = hashContent(systemPrompt)
      if (contentHashCache.get(file) === hash) return
      writeFileSync(file, systemPrompt, 'utf-8')
      contentHashCache.set(file, hash)
      logger.debug(`Wrote opencode system prompt to ${file}`)
    } else {
      // 清空时删除文件
      contentHashCache.delete(file)
      if (existsSync(file)) {
        unlinkSync(file)
        logger.debug(`Removed opencode system prompt file ${file}`)
      }
    }
  } catch (e) {
    logger.error(`Failed to write opencode system prompt: ${getErrorMessage(e)}`)
    // 不抛出异常，让 invoke 继续执行
  }
}

/**
 * 写入 iflow 全局 system prompt
 * 路径: ~/.iflow/IFLOW.md
 */
export function writeIflowSystemPrompt(systemPrompt: string): void {
  const dir = CONFIG_PATHS.iflow
  const file = join(dir, CONFIG_FILES.iflow)

  try {
    ensureDir(dir)

    if (systemPrompt) {
      const hash = hashContent(systemPrompt)
      if (contentHashCache.get(file) === hash) return
      writeFileSync(file, systemPrompt, 'utf-8')
      contentHashCache.set(file, hash)
      logger.debug(`Wrote iflow system prompt to ${file}`)
    } else {
      contentHashCache.delete(file)
      if (existsSync(file)) {
        unlinkSync(file)
        logger.debug(`Removed iflow system prompt file ${file}`)
      }
    }
  } catch (e) {
    logger.error(`Failed to write iflow system prompt: ${getErrorMessage(e)}`)
    // 不抛出异常，让 invoke 继续执行
  }
}

/**
 * 写入 qwen-code 全局 system prompt
 * 路径: ~/.qwen/QWEN.md
 */
export function writeQwenSystemPrompt(systemPrompt: string): void {
  const dir = CONFIG_PATHS.qwen
  const file = join(dir, CONFIG_FILES.qwen)

  try {
    ensureDir(dir)

    if (systemPrompt) {
      const hash = hashContent(systemPrompt)
      if (contentHashCache.get(file) === hash) return
      writeFileSync(file, systemPrompt, 'utf-8')
      contentHashCache.set(file, hash)
      logger.debug(`Wrote qwen system prompt to ${file}`)
    } else {
      contentHashCache.delete(file)
      if (existsSync(file)) {
        unlinkSync(file)
        logger.debug(`Removed qwen system prompt file ${file}`)
      }
    }
  } catch (e) {
    logger.error(`Failed to write qwen system prompt: ${getErrorMessage(e)}`)
    // 不抛出异常，让 invoke 继续执行
  }
}
