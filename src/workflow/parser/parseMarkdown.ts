/**
 * Markdown 解析器
 * 将 Markdown 格式的需求文档转换为 Workflow 定义
 */

import { marked } from 'marked'
import { createLogger } from '../../shared/logger.js'
import { generateId, generateShortId } from '../../shared/id.js'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../types.js'

const logger = createLogger('md-parser')

interface ParsedTask {
  name: string
  agent?: string
  type?: 'task' | 'human'
  dependencies: string[]
  description: string
  condition?: string
}

interface LoopRule {
  from: string
  to: string
  condition?: string
  maxLoops: number
}

/**
 * 解析 Markdown 内容为 Workflow
 */
export function parseMarkdown(content: string, sourceFile?: string): Workflow {
  const tokens = marked.lexer(content)

  let workflowName = ''
  let workflowDescription = ''
  let currentSection = ''
  const tasks: ParsedTask[] = []
  const loopRules: LoopRule[] = []

  let currentTask: Partial<ParsedTask> | null = null

  for (const token of tokens) {
    if (token.type === 'heading') {
      // 一级标题 = 工作流名称
      if (token.depth === 1) {
        workflowName = token.text.trim()
      }
      // 二级标题 = 章节
      else if (token.depth === 2) {
        // 保存当前任务
        if (currentTask?.name) {
          tasks.push(currentTask as ParsedTask)
        }
        currentTask = null
        currentSection = token.text.toLowerCase()
      }
      // 三级标题 = 任务节点
      else if (token.depth === 3) {
        // 保存上一个任务
        if (currentTask?.name) {
          tasks.push(currentTask as ParsedTask)
        }

        if (currentSection === '任务' || currentSection === 'tasks') {
          // 解析任务名称（去掉序号）
          const taskName = token.text.replace(/^\d+\.\s*/, '').trim()
          currentTask = {
            name: taskName,
            dependencies: [],
            description: '',
          }
        }
      }
    }
    // 段落 = 描述
    else if (token.type === 'paragraph') {
      if (currentSection === '背景' || currentSection === 'background') {
        workflowDescription += token.text + '\n'
      }
    }
    // 列表 = 任务属性或循环规则
    else if (token.type === 'list') {
      if (currentSection === '循环' || currentSection === 'loop' || currentSection === 'loops') {
        // 解析循环规则
        for (const item of token.items) {
          const rule = parseLoopRule(item.text)
          if (rule) {
            loopRules.push(rule)
          }
        }
      } else if (currentTask) {
        // 解析任务属性
        for (const item of token.items) {
          parseTaskProperty(currentTask, item.text)
        }
      }
    }
  }

  // 保存最后一个任务
  if (currentTask?.name) {
    tasks.push(currentTask as ParsedTask)
  }

  // 构建 Workflow
  return buildWorkflow(workflowName, workflowDescription, tasks, loopRules, sourceFile)
}

/**
 * 解析任务属性
 */
function parseTaskProperty(task: Partial<ParsedTask>, text: string): void {
  const lowerText = text.toLowerCase()

  // agent: xxx
  if (lowerText.startsWith('agent:')) {
    task.agent = text.substring(6).trim()
  }
  // 类型: human / type: human
  else if (lowerText.startsWith('类型:') || lowerText.startsWith('type:')) {
    const typeValue = text.split(':')[1]?.trim().toLowerCase()
    if (typeValue === 'human' || typeValue === '人工') {
      task.type = 'human'
    }
  }
  // 依赖: A, B / depends: A, B
  else if (lowerText.startsWith('依赖:') || lowerText.startsWith('depends:') || lowerText.startsWith('dependencies:')) {
    const depsStr = text.split(':')[1]?.trim() ?? ''
    task.dependencies = depsStr
      .split(/[,，]/)
      .map(d => d.trim())
      .filter(d => d.length > 0)
  }
  // 描述: xxx / description: xxx
  else if (lowerText.startsWith('描述:') || lowerText.startsWith('description:')) {
    task.description = text.split(':').slice(1).join(':').trim()
  }
  // 条件: xxx / condition: xxx
  else if (lowerText.startsWith('条件:') || lowerText.startsWith('condition:')) {
    task.condition = text.split(':').slice(1).join(':').trim()
  }
}

/**
 * 解析循环规则
 * 格式: 任务A → 任务B (当 condition, 最多 N 次)
 */
function parseLoopRule(text: string): LoopRule | null {
  // 匹配: 任务A → 任务B (当 xxx, 最多 N 次)
  const match = text.match(/(.+?)\s*(?:→|->)\s*(.+?)\s*\((.+?)\)/)
  if (!match) return null

  const from = match[1]?.trim()
  const to = match[2]?.trim()
  const options = match[3]

  if (!from || !to || !options) return null

  let condition: string | undefined
  let maxLoops = 3  // 默认最多 3 次

  // 解析选项
  const parts = options.split(/[,，]/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith('当') || trimmed.toLowerCase().startsWith('when')) {
      condition = trimmed.replace(/^(当|when)\s*/i, '')
    } else if (trimmed.includes('最多') || trimmed.toLowerCase().includes('max')) {
      const numMatch = trimmed.match(/(\d+)/)
      if (numMatch?.[1]) {
        maxLoops = parseInt(numMatch[1], 10)
      }
    }
  }

  return { from, to, condition, maxLoops }
}

/**
 * 构建 Workflow
 */
function buildWorkflow(
  name: string,
  description: string,
  tasks: ParsedTask[],
  loopRules: LoopRule[],
  sourceFile?: string
): Workflow {
  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', name: '开始' },
    { id: 'end', type: 'end', name: '结束' },
  ]

  const edges: WorkflowEdge[] = []
  const taskNameToId: Record<string, string> = {}
  let edgeIndex = 0

  // 创建任务节点
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!
    const nodeId = `task-${i + 1}`
    taskNameToId[task.name] = nodeId

    if (task.type === 'human') {
      nodes.push({
        id: nodeId,
        type: 'human',
        name: task.name,
        human: {
          timeout: 24 * 60 * 60 * 1000,  // 24小时
        },
      })
    } else {
      nodes.push({
        id: nodeId,
        type: 'task',
        name: task.name,
        task: {
          agent: task.agent || 'auto',
          prompt: task.description || task.name,
        },
      })
    }
  }

  // 创建边
  const nodesWithDeps = new Set<string>()

  for (const task of tasks) {
    const nodeId = taskNameToId[task.name]!

    if (task.dependencies.length === 0) {
      // 无依赖：从 start 连接
      edges.push({
        id: `e${++edgeIndex}`,
        from: 'start',
        to: nodeId,
      })
    } else {
      // 有依赖：从依赖节点连接
      for (const depName of task.dependencies) {
        const depId = taskNameToId[depName]
        if (depId) {
          nodesWithDeps.add(nodeId)
          edges.push({
            id: `e${++edgeIndex}`,
            from: depId,
            to: nodeId,
            condition: task.condition,
          })
        } else {
          logger.warn(`Unknown dependency: ${depName}`)
        }
      }
    }
  }

  // 找到没有下游的节点，连接到 end
  const nodesWithDownstream = new Set(edges.map(e => e.from))
  for (const task of tasks) {
    const nodeId = taskNameToId[task.name]!
    if (!nodesWithDownstream.has(nodeId)) {
      edges.push({
        id: `e${++edgeIndex}`,
        from: nodeId,
        to: 'end',
      })
    }
  }

  // 添加循环边
  for (const rule of loopRules) {
    const fromId = taskNameToId[rule.from]
    const toId = taskNameToId[rule.to]

    if (fromId && toId) {
      edges.push({
        id: `e${++edgeIndex}`,
        from: fromId,
        to: toId,
        condition: rule.condition,
        maxLoops: rule.maxLoops,
        label: 'loop',
      })
    } else {
      logger.warn(`Invalid loop rule: ${rule.from} → ${rule.to}`)
    }
  }

  return {
    id: generateId(),
    name: name || 'Unnamed Workflow',
    description: description.trim(),
    nodes,
    edges,
    variables: {},
    createdAt: new Date().toISOString(),
    sourceFile,
  }
}

/**
 * 验证 Markdown 格式
 */
export function validateMarkdown(content: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  const tokens = marked.lexer(content)

  let hasTitle = false
  let hasTaskSection = false
  let taskCount = 0

  for (const token of tokens) {
    if (token.type === 'heading') {
      if (token.depth === 1) {
        hasTitle = true
      } else if (token.depth === 2) {
        const section = token.text.toLowerCase()
        if (section === '任务' || section === 'tasks') {
          hasTaskSection = true
        }
      } else if (token.depth === 3) {
        taskCount++
      }
    }
  }

  if (!hasTitle) {
    errors.push('Missing workflow title (# Title)')
  }

  if (!hasTaskSection) {
    errors.push('Missing task section (## 任务)')
  }

  if (taskCount === 0) {
    errors.push('No tasks defined (### Task Name)')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
