/**
 * Workflow Markdown 解析器测试
 */

import { describe, it, expect } from 'vitest'
import { parseMarkdown, validateMarkdown } from '../src/workflow/parser/parseMarkdown.js'

describe('parseMarkdown', () => {
  describe('基础解析', () => {
    it('should parse workflow name from h1', () => {
      const md = `# 我的工作流

## 任务

### 1. 任务一

- 描述: 第一个任务
`
      const workflow = parseMarkdown(md)

      expect(workflow.name).toBe('我的工作流')
    })

    it('should parse description from background section', () => {
      const md = `# 工作流

## 背景

这是工作流的背景描述。

## 任务

### 1. 任务一

- 描述: 测试
`
      const workflow = parseMarkdown(md)

      expect(workflow.description).toContain('这是工作流的背景描述')
    })

    it('should parse tasks from h3 headings', () => {
      const md = `# 工作流

## 任务

### 1. 设计数据库

- 描述: 设计用户表

### 2. 实现API

- 描述: 实现接口

### 3. 编写测试

- 描述: 测试代码
`
      const workflow = parseMarkdown(md)

      // 应有 start, end + 3 个任务节点
      expect(workflow.nodes.length).toBe(5)

      const taskNodes = workflow.nodes.filter(n => n.type === 'task')
      expect(taskNodes.length).toBe(3)
      expect(taskNodes.map(n => n.name)).toEqual([
        '设计数据库',
        '实现API',
        '编写测试',
      ])
    })
  })

  describe('任务属性解析', () => {
    it('should parse agent property', () => {
      const md = `# 工作流

## 任务

### 1. 架构设计

- Agent: architect
- 描述: 设计系统架构
`
      const workflow = parseMarkdown(md)

      const taskNode = workflow.nodes.find(n => n.name === '架构设计')
      expect(taskNode?.task?.agent).toBe('architect')
    })

    it('should parse human type', () => {
      const md = `# 工作流

## 任务

### 1. 人工审核

- 类型: human
- 描述: 需要人工审批
`
      const workflow = parseMarkdown(md)

      const humanNode = workflow.nodes.find(n => n.name === '人工审核')
      expect(humanNode?.type).toBe('human')
    })

    it('should parse dependencies', () => {
      const md = `# 工作流

## 任务

### 1. 任务A

- 描述: 第一个任务

### 2. 任务B

- 依赖: 任务A
- 描述: 依赖任务A

### 3. 任务C

- 依赖: 任务A, 任务B
- 描述: 依赖任务A和B
`
      const workflow = parseMarkdown(md)

      // 检查边
      const edgeToB = workflow.edges.find(e => e.to === 'task-2')
      expect(edgeToB?.from).toBe('task-1')

      const edgesToC = workflow.edges.filter(e => e.to === 'task-3')
      expect(edgesToC.length).toBe(2)
    })

    it('should use default agent when not specified', () => {
      const md = `# 工作流

## 任务

### 1. 默认任务

- 描述: 没有指定agent
`
      const workflow = parseMarkdown(md)

      const taskNode = workflow.nodes.find(n => n.name === '默认任务')
      expect(taskNode?.task?.agent).toBe('auto')
    })
  })

  describe('边的生成', () => {
    it('should connect tasks without dependencies to start', () => {
      const md = `# 工作流

## 任务

### 1. 独立任务

- 描述: 没有依赖
`
      const workflow = parseMarkdown(md)

      const edgeFromStart = workflow.edges.find(e => e.from === 'start')
      expect(edgeFromStart?.to).toBe('task-1')
    })

    it('should connect tasks without downstream to end', () => {
      const md = `# 工作流

## 任务

### 1. 最后任务

- 描述: 没有下游
`
      const workflow = parseMarkdown(md)

      const edgeToEnd = workflow.edges.find(e => e.to === 'end')
      expect(edgeToEnd?.from).toBe('task-1')
    })

    it('should create parallel branches', () => {
      const md = `# 工作流

## 任务

### 1. 前置任务

- 描述: 开始

### 2. 并行任务A

- 依赖: 前置任务
- 描述: 分支A

### 3. 并行任务B

- 依赖: 前置任务
- 描述: 分支B
`
      const workflow = parseMarkdown(md)

      // task-1 应该有两条出边
      const edgesFromTask1 = workflow.edges.filter(e => e.from === 'task-1')
      expect(edgesFromTask1.length).toBe(2)
    })
  })

  describe('循环规则解析', () => {
    it('should parse loop rules', () => {
      const md = `# 工作流

## 任务

### 1. 执行任务

- 描述: 主任务

### 2. 检查结果

- 依赖: 执行任务
- 描述: 检查结果

## 循环

- 检查结果 → 执行任务 (当 outputs.check.needRetry == true, 最多 5 次)
`
      const workflow = parseMarkdown(md)

      // 应该有一条循环边
      const loopEdge = workflow.edges.find(e => e.label === 'loop')
      expect(loopEdge).toBeDefined()
      expect(loopEdge?.from).toBe('task-2')
      expect(loopEdge?.to).toBe('task-1')
      expect(loopEdge?.maxLoops).toBe(5)
      expect(loopEdge?.condition).toContain('outputs.check.needRetry')
    })

    it('should parse loop rules with -> syntax', () => {
      const md = `# 工作流

## 任务

### 1. 任务A

- 描述: A

### 2. 任务B

- 依赖: 任务A
- 描述: B

## 循环

- 任务B -> 任务A (当 loopCount < 3, 最多 3 次)
`
      const workflow = parseMarkdown(md)

      const loopEdge = workflow.edges.find(e => e.label === 'loop')
      expect(loopEdge?.maxLoops).toBe(3)
    })
  })
})

describe('validateMarkdown', () => {
  it('should pass valid markdown', () => {
    const md = `# 有效工作流

## 任务

### 1. 任务

- 描述: 测试
`
    const result = validateMarkdown(md)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should fail without title', () => {
    const md = `## 任务

### 1. 任务

- 描述: 测试
`
    const result = validateMarkdown(md)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing workflow title (# Title)')
  })

  it('should fail without task section', () => {
    const md = `# 工作流

## 背景

只有背景，没有任务
`
    const result = validateMarkdown(md)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing task section (## 任务)')
  })

  it('should fail without tasks', () => {
    const md = `# 工作流

## 任务

没有定义具体任务
`
    const result = validateMarkdown(md)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('No tasks defined (### Task Name)')
  })

  it('should accept English section names', () => {
    const md = `# Workflow

## Tasks

### 1. Task One

- Description: First task
`
    const result = validateMarkdown(md)

    expect(result.valid).toBe(true)
  })
})
