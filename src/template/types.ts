/**
 * 任务模板类型定义
 */

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

/**
 * 模板推荐结果
 */
export interface TemplateSuggestion {
  template: TaskTemplate
  score: number
  reason: string
}

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  development: '开发',
  testing: '测试',
  refactoring: '重构',
  documentation: '文档',
  devops: 'DevOps',
  analysis: '分析',
  custom: '自定义',
}
