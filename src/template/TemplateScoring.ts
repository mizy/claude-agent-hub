/**
 * 模板有效性评分逻辑
 */

import { writeJson } from '../store/readWriteJson.js'
import { createLogger } from '../shared/logger.js'
import { getAllTaskSummaries, type TaskSummary } from '../store/TaskStore.js'
import type { TaskTemplate } from './types.js'
import { getTemplate, getAllTemplates, getTemplateFilePath } from './TemplateCore.js'
import { extractKeywords } from './categorizeTask.js'

const logger = createLogger('template-scoring')

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

/**
 * 获取模板排行榜（按有效性评分排序）
 */
export function getTemplateRanking(): TaskTemplate[] {
  return getAllTemplates()
    .filter(t => t.effectivenessScore !== undefined)
    .sort((a, b) => (b.effectivenessScore || 0) - (a.effectivenessScore || 0))
}
