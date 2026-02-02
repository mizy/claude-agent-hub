/**
 * @entry Template 任务模板系统
 *
 * 提供常用任务的快速创建能力
 *
 * 主要 API:
 * - getAllTemplates(): 获取所有模板
 * - applyTemplate(): 应用模板创建任务
 * - suggestTemplates(): 根据描述推荐模板
 * - createTemplateFromTask(): 从历史任务创建模板
 */

// 类型导出
export type {
  TaskTemplate,
  TemplateCategory,
  TemplateVariable,
  TemplateSuggestion,
} from './types.js'

export { CATEGORY_LABELS } from './types.js'

// 核心模板管理
export {
  initBuiltinTemplates,
  getAllTemplates,
  getTemplatesByCategory,
  getTemplate,
  createTemplate,
  deleteTemplate,
  incrementUsageCount,
  applyTemplate,
  searchTemplates,
} from './TemplateCore.js'

// 模板推荐
export { suggestTemplates } from './TemplateSuggestion.js'

// 模板有效性评分
export {
  updateTemplateEffectiveness,
  recalculateAllEffectivenessScores,
  getTemplateRanking,
} from './TemplateScoring.js'

// 从历史任务生成模板
export {
  createTemplateFromTask,
  getTasksAvailableForTemplate,
} from './TemplateFromTask.js'
