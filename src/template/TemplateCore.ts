/**
 * 模板核心管理逻辑
 * 模板的创建、读取、删除、应用等基本操作
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { DATA_DIR } from '../store/paths.js'
import { readJson, writeJson } from '../store/readWriteJson.js'
import { createLogger } from '../shared/logger.js'
import type { TaskTemplate, TemplateCategory, TemplateVariable } from './types.js'
import { BUILTIN_TEMPLATES } from './builtinTemplates.js'

const logger = createLogger('template-core')

const TEMPLATES_DIR = `${DATA_DIR}/templates`

/**
 * 确保模板目录存在
 */
function ensureTemplatesDir(): void {
  if (!existsSync(TEMPLATES_DIR)) {
    mkdirSync(TEMPLATES_DIR, { recursive: true })
  }
}

/**
 * 获取模板文件路径
 */
export function getTemplateFilePath(templateId: string): string {
  return `${TEMPLATES_DIR}/${templateId}.json`
}

/**
 * 生成模板 ID
 */
function generateTemplateId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const timestamp = Date.now().toString(36)
  return `${base}-${timestamp}`
}

/**
 * 初始化内置模板
 */
export function initBuiltinTemplates(): void {
  ensureTemplatesDir()

  for (const template of BUILTIN_TEMPLATES) {
    const id = template.name
    const filePath = getTemplateFilePath(id)

    // 如果已存在，跳过
    if (existsSync(filePath)) continue

    const fullTemplate: TaskTemplate = {
      ...template,
      id,
      createdAt: new Date().toISOString(),
      usageCount: 0,
    }

    writeJson(filePath, fullTemplate)
    logger.debug(`Initialized builtin template: ${id}`)
  }
}

/**
 * 获取所有模板
 */
export function getAllTemplates(): TaskTemplate[] {
  ensureTemplatesDir()

  const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'))
  const templates: TaskTemplate[] = []

  for (const file of files) {
    const template = readJson<TaskTemplate>(`${TEMPLATES_DIR}/${file}`, { defaultValue: null })
    if (template) {
      templates.push(template)
    }
  }

  return templates.sort((a, b) => b.usageCount - a.usageCount)
}

/**
 * 按分类获取模板
 */
export function getTemplatesByCategory(category: TemplateCategory): TaskTemplate[] {
  return getAllTemplates().filter(t => t.category === category)
}

/**
 * 获取单个模板
 */
export function getTemplate(templateId: string): TaskTemplate | null {
  const filePath = getTemplateFilePath(templateId)
  if (!existsSync(filePath)) {
    return null
  }
  return readJson<TaskTemplate>(filePath, { defaultValue: null })
}

/**
 * 创建自定义模板
 */
export function createTemplate(
  name: string,
  description: string,
  prompt: string,
  options?: {
    category?: TemplateCategory
    variables?: TemplateVariable[]
    tags?: string[]
  }
): TaskTemplate {
  ensureTemplatesDir()

  const id = generateTemplateId(name)
  const template: TaskTemplate = {
    id,
    name,
    description,
    category: options?.category || 'custom',
    prompt,
    variables: options?.variables,
    tags: options?.tags,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  }

  writeJson(getTemplateFilePath(id), template)
  logger.info(`Created template: ${id}`)

  return template
}

/**
 * 删除模板
 */
export function deleteTemplate(templateId: string): boolean {
  const filePath = getTemplateFilePath(templateId)
  if (!existsSync(filePath)) {
    return false
  }

  unlinkSync(filePath)
  logger.info(`Deleted template: ${templateId}`)

  return true
}

/**
 * 增加使用计数
 */
export function incrementUsageCount(templateId: string): void {
  const template = getTemplate(templateId)
  if (template) {
    template.usageCount++
    template.updatedAt = new Date().toISOString()
    writeJson(getTemplateFilePath(templateId), template)
  }
}

/**
 * 应用模板生成任务描述
 */
export function applyTemplate(
  templateId: string,
  variables: Record<string, string>
): string | null {
  const template = getTemplate(templateId)
  if (!template) {
    return null
  }

  let prompt = template.prompt

  // 替换变量
  if (template.variables) {
    for (const variable of template.variables) {
      const value = variables[variable.name] ?? variable.defaultValue ?? ''
      const placeholder = `{{${variable.name}}}`
      prompt = prompt.replace(new RegExp(placeholder, 'g'), value)
    }
  }

  // 清理未替换的变量占位符
  prompt = prompt.replace(/\{\{[^}]+\}\}/g, '')

  // 更新使用计数
  incrementUsageCount(templateId)

  return prompt.trim()
}

/**
 * 搜索模板
 */
export function searchTemplates(query: string): TaskTemplate[] {
  const allTemplates = getAllTemplates()
  const lowerQuery = query.toLowerCase()

  return allTemplates.filter(t =>
    t.name.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery) ||
    t.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
  )
}

/**
 * 清理模板选项
 */
export interface CleanTemplatesOptions {
  /** 按模式匹配 ID */
  pattern?: string
  /** 最小使用次数（低于此值的将被清理） */
  minCount?: number
  /** 最小有效性评分（低于此值的将被清理） */
  minEffectiveness?: number
  /** 是否执行删除（false 则只预览） */
  execute?: boolean
}

/**
 * 清理模板结果
 */
export interface CleanTemplatesResult {
  /** 匹配要删除的模板 */
  matched: TaskTemplate[]
  /** 实际删除的模板 */
  deleted: string[]
  /** 是否只是预览模式 */
  dryRun: boolean
}

/**
 * 清理低质量/测试模板
 */
export function cleanTemplates(options: CleanTemplatesOptions): CleanTemplatesResult {
  const allTemplates = getAllTemplates()
  const execute = options.execute ?? false

  // 筛选要清理的模板
  const matched = allTemplates.filter(t => {
    // 按模式匹配
    if (options.pattern) {
      const regex = new RegExp(options.pattern.replace(/\*/g, '.*'), 'i')
      if (!regex.test(t.id) && !regex.test(t.name)) {
        return false
      }
    }

    // 按最小使用次数
    if (options.minCount !== undefined) {
      const totalCount = (t.successCount || 0) + (t.failureCount || 0)
      if (totalCount >= options.minCount) {
        return false
      }
    }

    // 按最小有效性评分
    if (options.minEffectiveness !== undefined && t.effectivenessScore !== undefined) {
      if (t.effectivenessScore >= options.minEffectiveness * 100) {
        return false
      }
    }

    // 如果没有任何匹配条件，不删除
    if (!options.pattern && options.minCount === undefined && options.minEffectiveness === undefined) {
      return false
    }

    return true
  })

  const deleted: string[] = []

  if (execute) {
    for (const tpl of matched) {
      if (deleteTemplate(tpl.id)) {
        deleted.push(tpl.id)
      }
    }
  }

  return {
    matched,
    deleted,
    dryRun: !execute,
  }
}
