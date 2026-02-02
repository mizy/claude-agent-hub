/**
 * 项目上下文感知
 * 分析项目结构，为 AI 生成 Workflow 提供上下文
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('project-context')

/**
 * 项目上下文信息
 */
export interface ProjectContext {
  /** 项目类型（nodejs, python, rust, etc） */
  projectType: string
  /** 主要语言 */
  mainLanguage: string
  /** 包管理器 */
  packageManager?: string
  /** 框架检测 */
  frameworks: string[]
  /** 目录结构摘要 */
  directoryStructure: string
  /** 关键文件 */
  keyFiles: string[]
  /** 可用脚本命令 */
  scripts: Record<string, string>
  /** README 摘要 */
  readmeSummary?: string
  /** CLAUDE.md 内容 */
  claudeMdContent?: string
}

/**
 * 分析项目结构
 */
export async function analyzeProjectContext(cwd: string = process.cwd()): Promise<ProjectContext> {
  logger.debug(`分析项目结构: ${cwd}`)

  const context: ProjectContext = {
    projectType: 'unknown',
    mainLanguage: 'unknown',
    frameworks: [],
    directoryStructure: '',
    keyFiles: [],
    scripts: {},
  }

  // 检测项目类型和语言
  detectProjectType(cwd, context)

  // 生成目录结构
  context.directoryStructure = generateDirectoryStructure(cwd)

  // 读取关键文件
  context.keyFiles = findKeyFiles(cwd)

  // 读取 package.json scripts
  if (existsSync(join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
      context.scripts = pkg.scripts || {}
    } catch {
      // ignore
    }
  }

  // 读取 README 摘要
  const readmePath = findReadme(cwd)
  if (readmePath) {
    context.readmeSummary = extractReadmeSummary(readmePath)
  }

  // 读取 CLAUDE.md
  const claudeMdPath = join(cwd, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    try {
      context.claudeMdContent = readFileSync(claudeMdPath, 'utf-8')
    } catch {
      // ignore
    }
  }

  logger.info(`项目分析完成: ${context.projectType} (${context.mainLanguage})`)
  return context
}

/**
 * 检测项目类型
 */
function detectProjectType(cwd: string, context: ProjectContext): void {
  // Node.js 项目
  if (existsSync(join(cwd, 'package.json'))) {
    context.projectType = 'nodejs'
    context.mainLanguage = 'javascript'

    // 检测 TypeScript
    if (existsSync(join(cwd, 'tsconfig.json'))) {
      context.mainLanguage = 'typescript'
    }

    // 检测包管理器
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
      context.packageManager = 'pnpm'
    } else if (existsSync(join(cwd, 'yarn.lock'))) {
      context.packageManager = 'yarn'
    } else if (existsSync(join(cwd, 'package-lock.json'))) {
      context.packageManager = 'npm'
    } else if (existsSync(join(cwd, 'bun.lockb'))) {
      context.packageManager = 'bun'
    }

    // 检测框架
    detectNodeFrameworks(cwd, context)
    return
  }

  // Python 项目
  if (
    existsSync(join(cwd, 'pyproject.toml')) ||
    existsSync(join(cwd, 'setup.py')) ||
    existsSync(join(cwd, 'requirements.txt'))
  ) {
    context.projectType = 'python'
    context.mainLanguage = 'python'

    // 检测包管理器
    if (existsSync(join(cwd, 'poetry.lock'))) {
      context.packageManager = 'poetry'
    } else if (existsSync(join(cwd, 'Pipfile.lock'))) {
      context.packageManager = 'pipenv'
    } else if (existsSync(join(cwd, 'uv.lock'))) {
      context.packageManager = 'uv'
    }
    return
  }

  // Rust 项目
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    context.projectType = 'rust'
    context.mainLanguage = 'rust'
    context.packageManager = 'cargo'
    return
  }

  // Go 项目
  if (existsSync(join(cwd, 'go.mod'))) {
    context.projectType = 'go'
    context.mainLanguage = 'go'
    return
  }
}

/**
 * 检测 Node.js 框架
 */
function detectNodeFrameworks(cwd: string, context: ProjectContext): void {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    // 前端框架
    if (deps['react']) context.frameworks.push('react')
    if (deps['vue']) context.frameworks.push('vue')
    if (deps['svelte']) context.frameworks.push('svelte')
    if (deps['next']) context.frameworks.push('nextjs')
    if (deps['nuxt']) context.frameworks.push('nuxt')

    // 后端框架
    if (deps['express']) context.frameworks.push('express')
    if (deps['fastify']) context.frameworks.push('fastify')
    if (deps['koa']) context.frameworks.push('koa')
    if (deps['nestjs'] || deps['@nestjs/core']) context.frameworks.push('nestjs')

    // 测试框架
    if (deps['vitest']) context.frameworks.push('vitest')
    if (deps['jest']) context.frameworks.push('jest')
    if (deps['mocha']) context.frameworks.push('mocha')

    // 构建工具
    if (deps['vite']) context.frameworks.push('vite')
    if (deps['webpack']) context.frameworks.push('webpack')
    if (deps['esbuild']) context.frameworks.push('esbuild')
    if (deps['tsup']) context.frameworks.push('tsup')
  } catch {
    // ignore
  }
}

/**
 * 生成目录结构（简洁版）
 */
function generateDirectoryStructure(cwd: string, maxDepth: number = 2): string {
  const lines: string[] = []
  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '__pycache__',
    '.venv',
    'venv',
    'target',
  ])

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return

    let entries: string[]
    try {
      entries = readdirSync(dir, { encoding: 'utf-8' })
    } catch {
      return
    }

    // 过滤和排序
    entries = entries
      .filter(e => !e.startsWith('.') && !ignoreDirs.has(e))
      .sort((a, b) => {
        try {
          const aIsDir = statSync(join(dir, a)).isDirectory()
          const bIsDir = statSync(join(dir, b)).isDirectory()
          if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
        } catch {
          // ignore stat errors
        }
        return a.localeCompare(b)
      })

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      const fullPath = join(dir, entry)
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const childPrefix = isLast ? '    ' : '│   '

      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          lines.push(`${prefix}${connector}${entry}/`)
          walk(fullPath, prefix + childPrefix, depth + 1)
        } else {
          lines.push(`${prefix}${connector}${entry}`)
        }
      } catch {
        // ignore
      }
    }
  }

  walk(cwd, '', 0)
  return lines.join('\n')
}

/**
 * 查找关键文件
 */
function findKeyFiles(cwd: string): string[] {
  const keyFiles: string[] = []
  const patterns = [
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'Makefile',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    '.env.example',
  ]

  for (const pattern of patterns) {
    if (existsSync(join(cwd, pattern))) {
      keyFiles.push(pattern)
    }
  }

  return keyFiles
}

/**
 * 查找 README
 */
function findReadme(cwd: string): string | null {
  const names = ['README.md', 'readme.md', 'README', 'readme']
  for (const name of names) {
    const path = join(cwd, name)
    if (existsSync(path)) return path
  }
  return null
}

/**
 * 提取 README 摘要（前 500 字）
 */
function extractReadmeSummary(path: string): string {
  try {
    const content = readFileSync(path, 'utf-8')
    // 取前 500 字符，截断到完整行
    const truncated = content.slice(0, 500)
    const lastNewline = truncated.lastIndexOf('\n')
    return lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated
  } catch {
    return ''
  }
}

/**
 * 格式化项目上下文为 Prompt 片段
 */
export function formatProjectContextForPrompt(context: ProjectContext): string {
  const parts: string[] = []

  // 基本信息
  parts.push(`## 项目信息`)
  parts.push(`- 类型: ${context.projectType}`)
  parts.push(`- 语言: ${context.mainLanguage}`)
  if (context.packageManager) {
    parts.push(`- 包管理器: ${context.packageManager}`)
  }
  if (context.frameworks.length > 0) {
    parts.push(`- 框架: ${context.frameworks.join(', ')}`)
  }

  // 目录结构 - 不输出，让 AI 自行探索
  // if (context.directoryStructure) {
  //   parts.push(`\n## 目录结构`)
  //   parts.push('```')
  //   parts.push(context.directoryStructure)
  //   parts.push('```')
  // }

  // 可用脚本
  const scriptEntries = Object.entries(context.scripts)
  if (scriptEntries.length > 0) {
    parts.push(`\n## 可用脚本`)
    for (const [name, cmd] of scriptEntries.slice(0, 10)) {
      parts.push(`- \`${context.packageManager || 'npm'} run ${name}\`: ${cmd ?? ''}`)
    }
    if (scriptEntries.length > 10) {
      parts.push(`- ... 共 ${scriptEntries.length} 个脚本`)
    }
  }

  // CLAUDE.md 项目规范
  if (context.claudeMdContent) {
    parts.push(`\n## 项目规范 (CLAUDE.md)`)
    // 只取前 1000 字
    const summary = context.claudeMdContent.slice(0, 1000)
    parts.push(summary)
    if (context.claudeMdContent.length > 1000) {
      parts.push('...(截断)')
    }
  }

  return parts.join('\n')
}
