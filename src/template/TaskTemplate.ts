/**
 * 任务模板系统
 * 提供常用任务的快速创建能力
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { readJson, writeJson } from '../store/json.js'
import { DATA_DIR, TASKS_DIR } from '../store/paths.js'
import { createLogger } from '../shared/logger.js'
import { getAllTaskSummaries, type TaskSummary, getTask } from '../store/TaskStore.js'
import type { Workflow } from '../workflow/types.js'

const logger = createLogger('task-template')

// ============ 路径和常量 ============

const TEMPLATES_DIR = `${DATA_DIR}/templates`

// ============ 类型定义 ============

export interface TaskTemplate {
  id: string
  name: string
  description: string
  category: TemplateCategory
  prompt: string
  variables?: TemplateVariable[]
  tags?: string[]
  createdAt: string
  updatedAt?: string
  usageCount: number
  /** 有效性评分 (0-100)，基于使用该模板的任务成功率 */
  effectivenessScore?: number
  /** 成功使用次数 */
  successCount?: number
  /** 失败使用次数 */
  failureCount?: number
  /** 从历史任务自动生成的标记 */
  generatedFromTask?: string
  /** 关联的任务类型 */
  taskCategory?: string
}

export type TemplateCategory =
  | 'development'   // 开发任务
  | 'testing'       // 测试任务
  | 'refactoring'   // 重构任务
  | 'documentation' // 文档任务
  | 'devops'        // DevOps 任务
  | 'analysis'      // 分析任务
  | 'custom'        // 自定义任务

export interface TemplateVariable {
  name: string
  description: string
  defaultValue?: string
  required?: boolean
}

// ============ 内置模板 ============

const BUILTIN_TEMPLATES: Omit<TaskTemplate, 'id' | 'createdAt' | 'usageCount'>[] = [
  // 开发任务
  {
    name: 'implement-feature',
    description: '实现新功能',
    category: 'development',
    prompt: '实现以下功能: {{feature_description}}\n\n要求:\n- 遵循项目现有的代码风格和架构\n- 添加必要的类型定义\n- 处理边界情况和错误',
    variables: [
      { name: 'feature_description', description: '功能描述', required: true },
    ],
    tags: ['feature', 'development'],
  },
  {
    name: 'fix-bug',
    description: '修复 Bug',
    category: 'development',
    prompt: '修复以下问题: {{bug_description}}\n\n{{reproduction_steps}}\n\n期望行为: {{expected_behavior}}',
    variables: [
      { name: 'bug_description', description: 'Bug 描述', required: true },
      { name: 'reproduction_steps', description: '复现步骤', defaultValue: '' },
      { name: 'expected_behavior', description: '期望行为', defaultValue: '' },
    ],
    tags: ['bugfix', 'development'],
  },
  {
    name: 'add-api-endpoint',
    description: '添加 API 端点',
    category: 'development',
    prompt: '添加新的 API 端点:\n\n端点: {{method}} {{path}}\n描述: {{description}}\n\n请求参数:\n{{request_params}}\n\n响应格式:\n{{response_format}}',
    variables: [
      { name: 'method', description: 'HTTP 方法', defaultValue: 'GET' },
      { name: 'path', description: 'API 路径', required: true },
      { name: 'description', description: '端点描述', required: true },
      { name: 'request_params', description: '请求参数', defaultValue: '无' },
      { name: 'response_format', description: '响应格式', defaultValue: 'JSON' },
    ],
    tags: ['api', 'development'],
  },

  // 测试任务
  {
    name: 'write-unit-tests',
    description: '编写单元测试',
    category: 'testing',
    prompt: '为以下模块编写单元测试: {{module_path}}\n\n测试要求:\n- 覆盖主要功能路径\n- 包含边界情况测试\n- 包含错误处理测试\n- 使用项目现有的测试框架',
    variables: [
      { name: 'module_path', description: '模块路径', required: true },
    ],
    tags: ['testing', 'unit-test'],
  },
  {
    name: 'add-integration-tests',
    description: '添加集成测试',
    category: 'testing',
    prompt: '为以下功能添加集成测试: {{feature_name}}\n\n测试场景:\n{{test_scenarios}}\n\n确保测试覆盖完整的用户流程。',
    variables: [
      { name: 'feature_name', description: '功能名称', required: true },
      { name: 'test_scenarios', description: '测试场景', defaultValue: '' },
    ],
    tags: ['testing', 'integration'],
  },

  // 重构任务
  {
    name: 'refactor-module',
    description: '重构模块',
    category: 'refactoring',
    prompt: '重构以下模块: {{module_path}}\n\n重构目标:\n{{refactor_goals}}\n\n约束:\n- 保持现有 API 兼容\n- 确保测试通过\n- 不引入新依赖',
    variables: [
      { name: 'module_path', description: '模块路径', required: true },
      { name: 'refactor_goals', description: '重构目标', defaultValue: '提升代码可读性和可维护性' },
    ],
    tags: ['refactoring'],
  },
  {
    name: 'extract-component',
    description: '抽取组件/函数',
    category: 'refactoring',
    prompt: '从 {{source_file}} 中抽取 {{component_name}}\n\n抽取原因: {{reason}}\n\n目标位置: {{target_path}}',
    variables: [
      { name: 'source_file', description: '源文件', required: true },
      { name: 'component_name', description: '组件/函数名', required: true },
      { name: 'reason', description: '抽取原因', defaultValue: '提高复用性' },
      { name: 'target_path', description: '目标路径', defaultValue: '自动选择' },
    ],
    tags: ['refactoring', 'component'],
  },

  // 文档任务
  {
    name: 'generate-docs',
    description: '生成文档',
    category: 'documentation',
    prompt: '为以下模块生成文档: {{module_path}}\n\n文档要求:\n- 包含 API 说明\n- 包含使用示例\n- 包含参数说明\n- 使用 {{doc_format}} 格式',
    variables: [
      { name: 'module_path', description: '模块路径', required: true },
      { name: 'doc_format', description: '文档格式', defaultValue: 'JSDoc' },
    ],
    tags: ['documentation'],
  },
  {
    name: 'update-readme',
    description: '更新 README',
    category: 'documentation',
    prompt: '更新 README.md，添加以下内容:\n\n{{content_to_add}}\n\n保持现有文档结构，只添加/更新必要的部分。',
    variables: [
      { name: 'content_to_add', description: '要添加的内容', required: true },
    ],
    tags: ['documentation', 'readme'],
  },

  // DevOps 任务
  {
    name: 'setup-ci',
    description: '配置 CI/CD',
    category: 'devops',
    prompt: '配置 CI/CD 流水线:\n\n平台: {{ci_platform}}\n\n需要的步骤:\n- {{pipeline_steps}}\n\n触发条件: {{triggers}}',
    variables: [
      { name: 'ci_platform', description: 'CI 平台', defaultValue: 'GitHub Actions' },
      { name: 'pipeline_steps', description: '流水线步骤', defaultValue: 'lint, test, build' },
      { name: 'triggers', description: '触发条件', defaultValue: 'push to main, pull request' },
    ],
    tags: ['devops', 'ci'],
  },
  {
    name: 'add-docker',
    description: '添加 Docker 支持',
    category: 'devops',
    prompt: '为项目添加 Docker 支持:\n\n基础镜像: {{base_image}}\n暴露端口: {{ports}}\n\n要求:\n- 多阶段构建\n- 生产环境优化\n- 添加 docker-compose.yml (如需要)',
    variables: [
      { name: 'base_image', description: '基础镜像', defaultValue: 'node:20-alpine' },
      { name: 'ports', description: '暴露端口', defaultValue: '3000' },
    ],
    tags: ['devops', 'docker'],
  },

  // 分析任务
  {
    name: 'analyze-performance',
    description: '性能分析',
    category: 'analysis',
    prompt: '分析以下模块/功能的性能: {{target}}\n\n关注点:\n- 时间复杂度\n- 内存使用\n- 潜在瓶颈\n\n提供优化建议。',
    variables: [
      { name: 'target', description: '分析目标', required: true },
    ],
    tags: ['analysis', 'performance'],
  },
  {
    name: 'code-review',
    description: '代码审查',
    category: 'analysis',
    prompt: '审查以下文件/模块的代码: {{file_path}}\n\n审查重点:\n- 代码质量\n- 潜在 Bug\n- 安全问题\n- 可维护性\n\n提供改进建议。',
    variables: [
      { name: 'file_path', description: '文件路径', required: true },
    ],
    tags: ['analysis', 'review'],
  },
]

// ============ 模板管理 ============

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
function getTemplateFilePath(templateId: string): string {
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

// ============ 模板应用 ============

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

// ============ 类别映射 ============

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  development: '开发',
  testing: '测试',
  refactoring: '重构',
  documentation: '文档',
  devops: 'DevOps',
  analysis: '分析',
  custom: '自定义',
}

// ============ 历史数据分析 ============

/**
 * 任务分类（与 executionHistory 保持一致）
 */
type TaskCategory = 'git' | 'refactor' | 'feature' | 'fix' | 'docs' | 'test' | 'iteration' | 'other'

/**
 * 分类任务类型
 */
function categorizeTask(title: string, description?: string): TaskCategory {
  const text = `${title} ${description || ''}`.toLowerCase()

  if (/commit|push|pull|merge|提交|推送|合并/.test(text)) return 'git'
  if (/迭代|进化|iteration|evolution|cycle|周期/.test(text)) return 'iteration'
  if (/refactor|重构|优化|整理|reorganize/.test(text)) return 'refactor'
  if (/fix|bug|修复|修正|repair/.test(text)) return 'fix'
  if (/test|测试|spec|unittest/.test(text)) return 'test'
  if (/doc|文档|readme|changelog/.test(text)) return 'docs'
  if (/add|feature|implement|新增|添加|实现|功能/.test(text)) return 'feature'

  return 'other'
}

/**
 * 模板推荐结果
 */
export interface TemplateSuggestion {
  template: TaskTemplate
  score: number
  reason: string
}

/**
 * 基于任务描述推荐模板
 */
export function suggestTemplates(taskDescription: string, limit: number = 5): TemplateSuggestion[] {
  const allTemplates = getAllTemplates()
  if (allTemplates.length === 0) return []

  const taskCategory = categorizeTask(taskDescription, taskDescription)
  const keywords = extractKeywords(taskDescription)
  const suggestions: TemplateSuggestion[] = []

  for (const template of allTemplates) {
    let score = 0
    const reasons: string[] = []

    // 1. 关键词匹配 (最高 40 分)
    const templateKeywords = extractKeywords(`${template.name} ${template.description} ${template.prompt}`)
    const matchedKeywords = keywords.filter(k => templateKeywords.includes(k))
    const keywordScore = Math.min(40, matchedKeywords.length * 10)
    if (keywordScore > 0) {
      score += keywordScore
      reasons.push(`关键词匹配: ${matchedKeywords.slice(0, 3).join(', ')}`)
    }

    // 2. 标签匹配 (最高 20 分)
    if (template.tags) {
      const matchedTags = template.tags.filter(tag =>
        keywords.some(k => tag.toLowerCase().includes(k) || k.includes(tag.toLowerCase()))
      )
      if (matchedTags.length > 0) {
        score += Math.min(20, matchedTags.length * 10)
        reasons.push(`标签匹配: ${matchedTags.join(', ')}`)
      }
    }

    // 3. 任务类型匹配 (最高 25 分)
    const categoryMapping: Record<TaskCategory, TemplateCategory[]> = {
      git: ['development', 'devops'],
      refactor: ['refactoring'],
      feature: ['development'],
      fix: ['development'],
      docs: ['documentation'],
      test: ['testing'],
      iteration: ['development', 'refactoring'],
      other: ['custom'],
    }
    if (categoryMapping[taskCategory]?.includes(template.category)) {
      score += 25
      reasons.push(`类型匹配: ${taskCategory}`)
    }

    // 4. 有效性评分加成 (最高 15 分)
    if (template.effectivenessScore !== undefined && template.effectivenessScore > 0) {
      const effectivenessBonus = Math.round(template.effectivenessScore * 0.15)
      score += effectivenessBonus
      reasons.push(`有效性评分: ${template.effectivenessScore}%`)
    }

    // 5. 使用频率加成 (最高 10 分)
    if (template.usageCount > 0) {
      const usageBonus = Math.min(10, Math.round(Math.log10(template.usageCount + 1) * 5))
      score += usageBonus
      if (usageBonus > 3) {
        reasons.push(`使用${template.usageCount}次`)
      }
    }

    if (score > 0) {
      suggestions.push({
        template,
        score,
        reason: reasons.join('; '),
      })
    }
  }

  // 按分数排序并限制数量
  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)

  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by',
    'for', 'with', 'about', 'to', 'from', 'in', 'on', 'of', 'as',
    '的', '是', '在', '和', '了', '有', '个', '这', '那', '我', '你', '他',
    '请', '把', '让', '给', '做', '用', '到', '会', '要', '能', '可以',
  ])

  return [...new Set(words.filter(w => !stopWords.has(w)))]
}

// ============ 模板有效性评分 ============

/**
 * 更新模板有效性评分（基于任务执行结果）
 */
export function updateTemplateEffectiveness(templateId: string, success: boolean): void {
  const template = getTemplate(templateId)
  if (!template) return

  // 更新成功/失败计数
  if (success) {
    template.successCount = (template.successCount || 0) + 1
  } else {
    template.failureCount = (template.failureCount || 0) + 1
  }

  // 计算有效性评分
  const total = (template.successCount || 0) + (template.failureCount || 0)
  if (total > 0) {
    template.effectivenessScore = Math.round(((template.successCount || 0) / total) * 100)
  }

  template.updatedAt = new Date().toISOString()
  writeJson(getTemplateFilePath(templateId), template)
  logger.debug(`Updated template effectiveness: ${templateId} -> ${template.effectivenessScore}%`)
}

/**
 * 从历史任务数据重新计算所有模板的有效性评分
 */
export function recalculateAllEffectivenessScores(): void {
  const allTemplates = getAllTemplates()
  const allTasks = getAllTaskSummaries()

  // 从任务历史中查找使用了模板的任务
  // 目前简单实现：基于任务标题和模板名的匹配
  for (const template of allTemplates) {
    const relatedTasks = findTasksRelatedToTemplate(template, allTasks)

    if (relatedTasks.length === 0) continue

    const successTasks = relatedTasks.filter(t => t.status === 'completed')
    const failedTasks = relatedTasks.filter(t => t.status === 'failed')

    template.successCount = successTasks.length
    template.failureCount = failedTasks.length

    const total = successTasks.length + failedTasks.length
    if (total > 0) {
      template.effectivenessScore = Math.round((successTasks.length / total) * 100)
    }

    template.updatedAt = new Date().toISOString()
    writeJson(getTemplateFilePath(template.id), template)
  }

  logger.info('Recalculated effectiveness scores for all templates')
}

/**
 * 查找与模板相关的任务
 */
function findTasksRelatedToTemplate(template: TaskTemplate, tasks: TaskSummary[]): TaskSummary[] {
  const templateKeywords = extractKeywords(`${template.name} ${template.description}`)

  return tasks.filter(task => {
    const taskKeywords = extractKeywords(task.title)
    const overlap = templateKeywords.filter(k => taskKeywords.includes(k))
    return overlap.length >= 2 // 至少 2 个关键词匹配
  })
}

// ============ 从历史任务生成模板 ============

/**
 * 从成功的历史任务生成模板
 */
export function createTemplateFromTask(taskId: string): TaskTemplate | null {
  const task = getTask(taskId)
  if (!task) {
    logger.warn(`Task not found: ${taskId}`)
    return null
  }

  if (task.status !== 'completed') {
    logger.warn(`Task not completed: ${taskId} (status: ${task.status})`)
    return null
  }

  // 读取 workflow 获取节点信息
  const workflowPath = join(TASKS_DIR, taskId, 'workflow.json')
  let nodeInfo = ''
  if (existsSync(workflowPath)) {
    try {
      const workflow: Workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'))
      const taskNodes = workflow.nodes?.filter(n => n.type === 'task') || []
      if (taskNodes.length > 0) {
        nodeInfo = `\n\n执行步骤参考：\n${taskNodes.map((n, i) => `${i + 1}. ${n.name}`).join('\n')}`
      }
    } catch {
      // ignore
    }
  }

  // 生成模板
  const taskCategory = categorizeTask(task.title, task.description)
  const categoryToTemplateCategory: Record<TaskCategory, TemplateCategory> = {
    git: 'devops',
    refactor: 'refactoring',
    feature: 'development',
    fix: 'development',
    docs: 'documentation',
    test: 'testing',
    iteration: 'development',
    other: 'custom',
  }

  const templateCategory = categoryToTemplateCategory[taskCategory]

  // 提取变量（简单实现：从描述中提取常见占位符模式）
  const variables: TemplateVariable[] = []
  const descText = task.description || ''

  // 检测可能的变量部分（文件名、路径、功能名等）
  if (/文件|file|path|路径/.test(descText.toLowerCase())) {
    variables.push({ name: 'target_path', description: '目标路径', required: false })
  }
  if (/功能|feature|function|模块/.test(descText.toLowerCase())) {
    variables.push({ name: 'feature_name', description: '功能名称', required: false })
  }

  const template = createTemplate(
    `from-${task.id}`,
    `基于任务「${task.title}」生成`,
    `${task.description || task.title}${nodeInfo}`,
    {
      category: templateCategory,
      variables: variables.length > 0 ? variables : undefined,
      tags: [taskCategory, 'auto-generated'],
    }
  )

  // 标记为从任务生成
  const savedTemplate = getTemplate(template.id)
  if (savedTemplate) {
    savedTemplate.generatedFromTask = taskId
    savedTemplate.taskCategory = taskCategory
    savedTemplate.effectivenessScore = 100 // 从成功任务生成，初始评分 100
    savedTemplate.successCount = 1
    writeJson(getTemplateFilePath(savedTemplate.id), savedTemplate)
  }

  logger.info(`Created template from task: ${taskId} -> ${template.id}`)
  return getTemplate(template.id)
}

/**
 * 获取可用于生成模板的成功任务列表
 */
export function getTasksAvailableForTemplate(): TaskSummary[] {
  const allTasks = getAllTaskSummaries()
  return allTasks.filter(t => t.status === 'completed')
}

/**
 * 获取模板排行榜（按有效性评分排序）
 */
export function getTemplateRanking(): TaskTemplate[] {
  return getAllTemplates()
    .filter(t => t.effectivenessScore !== undefined)
    .sort((a, b) => (b.effectivenessScore || 0) - (a.effectivenessScore || 0))
}
