/**
 * 模板推荐逻辑
 */

import type { TemplateCategory, TemplateSuggestion } from './types.js'
import { getAllTemplates } from './TemplateCore.js'
import { extractKeywords, categorizeTask, type TaskCategory } from './categorizeTask.js'

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
