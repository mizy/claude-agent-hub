#!/usr/bin/env node
/**
 * CAH CLI 入口点
 *
 * 此文件不被打包，用于在加载主程序前处理环境变量
 *
 * 数据目录优先级（从高到低）：
 * 1. 命令行参数 -d / --data-dir
 * 2. 环境变量 CAH_DATA_DIR
 * 3. 当前目录下的 .cah-data/
 * 4. 用户主目录 ~/.cah-data/
 */

import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'

// 展开路径中的 ~ 为用户主目录
function expandTilde(p) {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2))
  }
  if (p === '~') {
    return homedir()
  }
  return p
}

// 解析数据目录（按优先级）
function resolveDataDir() {
  // 1. 命令行参数 -d / --data-dir（最高优先级）
  const dataDirIndex = process.argv.indexOf('--data-dir')
  const dataDirShortIndex = process.argv.indexOf('-d')
  const argIndex = dataDirIndex !== -1 ? dataDirIndex : dataDirShortIndex

  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    const dir = expandTilde(process.argv[argIndex + 1])
    return resolve(dir)
  }

  // 2. 环境变量 CAH_DATA_DIR
  if (process.env.CAH_DATA_DIR) {
    return process.env.CAH_DATA_DIR.startsWith('/')
      ? process.env.CAH_DATA_DIR
      : resolve(process.env.CAH_DATA_DIR)
  }

  // 3. 当前目录下的 .cah-data/
  const cwdDataDir = join(process.cwd(), '.cah-data')
  if (existsSync(cwdDataDir)) {
    return cwdDataDir
  }

  // 4. 用户主目录 ~/.cah-data/
  const homeDataDir = join(homedir(), '.cah-data')
  if (existsSync(homeDataDir)) {
    return homeDataDir
  }

  // 默认：当前目录（会在需要时创建）
  return cwdDataDir
}

// 设置环境变量供后续模块使用
process.env.CAH_DATA_DIR = resolveDataDir()

// 加载实际的 CLI
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
await import(join(__dirname, '../dist/cli/index.js'))
