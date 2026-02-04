#!/usr/bin/env node
/**
 * CAH CLI 入口点
 *
 * 此文件不被打包，用于在加载主程序前处理环境变量
 *
 * 数据目录优先级（从高到低）：
 * 1. 环境变量 CAH_DATA_DIR
 * 2. 命令行参数 -d / --data-dir
 * 3. 默认值 ./.cah-data
 */

import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 只有当环境变量未设置时，才从命令行参数读取
if (!process.env.CAH_DATA_DIR) {
  const dataDirIndex = process.argv.indexOf('--data-dir')
  const dataDirShortIndex = process.argv.indexOf('-d')
  const argIndex = dataDirIndex !== -1 ? dataDirIndex : dataDirShortIndex

  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    process.env.CAH_DATA_DIR = resolve(process.argv[argIndex + 1])
  }
}

// 加载实际的 CLI
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
await import(join(__dirname, '../dist/cli/index.js'))
