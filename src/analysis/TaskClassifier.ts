/**
 * 任务分类器
 * 根据任务标题和描述识别任务类型
 */

/**
 * 任务类型分类
 */
export type TaskCategory =
  | 'git'
  | 'refactor'
  | 'feature'
  | 'fix'
  | 'docs'
  | 'test'
  | 'iteration'
  | 'other'

/**
 * 分类任务类型
 */
export function categorizeTask(title: string, description?: string): TaskCategory {
  const text = `${title} ${description || ''}`.toLowerCase()

  // Git 相关
  if (/commit|push|pull|merge|提交|推送|合并/.test(text)) {
    return 'git'
  }

  // 迭代/进化
  if (/迭代|进化|iteration|evolution|cycle|周期/.test(text)) {
    return 'iteration'
  }

  // 重构
  if (/refactor|重构|优化|整理|reorganize/.test(text)) {
    return 'refactor'
  }

  // 修复
  if (/fix|bug|修复|修正|repair/.test(text)) {
    return 'fix'
  }

  // 测试
  if (/test|测试|spec|unittest/.test(text)) {
    return 'test'
  }

  // 文档
  if (/doc|文档|readme|changelog/.test(text)) {
    return 'docs'
  }

  // 功能开发
  if (/add|feature|implement|新增|添加|实现|功能/.test(text)) {
    return 'feature'
  }

  return 'other'
}

/**
 * 提取关键词
 */
export function extractKeywords(text: string): string[] {
  // 分词（简单实现）
  const words = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)

  // 去除常见停用词
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'and',
    'or',
    'but',
    'if',
    'then',
    'else',
    'when',
    'at',
    'by',
    'for',
    'with',
    'about',
    'to',
    'from',
    'in',
    'on',
    'of',
    'as',
    '的',
    '是',
    '在',
    '和',
    '了',
    '有',
    '个',
    '这',
    '那',
    '我',
    '你',
    '他',
    '请',
    '把',
    '让',
    '给',
    '做',
    '用',
    '到',
    '会',
    '要',
    '能',
    '可以',
  ])

  return [...new Set(words.filter(w => !stopWords.has(w)))]
}
