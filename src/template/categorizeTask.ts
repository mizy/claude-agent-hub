/**
 * 模板系统工具函数
 */

/**
 * 任务分类（与 executionHistory 保持一致）
 */
export type TaskCategory = 'git' | 'refactor' | 'feature' | 'fix' | 'docs' | 'test' | 'iteration' | 'other'

/**
 * 分类任务类型
 */
export function categorizeTask(title: string, description?: string): TaskCategory {
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
 * 提取关键词
 */
export function extractKeywords(text: string): string[] {
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
