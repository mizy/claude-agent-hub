/**
 * 从历史任务生成模板
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { TASKS_DIR } from '../store/paths.js'
import { writeJson } from '../store/readWriteJson.js'
import { createLogger } from '../shared/logger.js'
import { getAllTaskSummaries, type TaskSummary, getTask } from '../store/TaskStore.js'
import type { Workflow } from '../workflow/types.js'
import type { TaskTemplate, TemplateCategory, TemplateVariable } from './types.js'
import { createTemplate, getTemplate, getTemplateFilePath } from './TemplateCore.js'
import { categorizeTask, type TaskCategory } from './categorizeTask.js'

const logger = createLogger('template-from-task')

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
