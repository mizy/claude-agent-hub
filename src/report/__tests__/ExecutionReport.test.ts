/**
 * ExecutionReport 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateExecutionReport,
  formatReportForTerminal,
  formatReportForMarkdown,
  type ExecutionReport,
} from '../ExecutionReport.js'

// Mock dependencies
vi.mock('../../store/TaskStore.js', () => ({
  getTask: vi.fn(),
  getTaskFolder: vi.fn(),
}))

vi.mock('../../store/TaskWorkflowStore.js', () => ({
  getTaskWorkflow: vi.fn(),
  getTaskInstance: vi.fn(),
}))

vi.mock('../../store/ExecutionStatsStore.js', () => ({
  getExecutionStats: vi.fn(),
  getExecutionTimeline: vi.fn(),
  formatDuration: (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m`
  },
}))

vi.mock('../../store/TaskLogStore.js', () => ({}))

import { getTask, getTaskFolder } from '../../store/TaskStore.js'
import { getTaskWorkflow, getTaskInstance } from '../../store/TaskWorkflowStore.js'
import { getExecutionStats, getExecutionTimeline } from '../../store/ExecutionStatsStore.js'

describe('ExecutionReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateExecutionReport', () => {
    it('should return null if task not found', () => {
      vi.mocked(getTask).mockReturnValue(null)

      const report = generateExecutionReport('non-existent-task')
      expect(report).toBeNull()
    })

    it('should generate a valid report for a completed task', () => {
      // Setup mocks
      vi.mocked(getTask).mockReturnValue({
        id: 'task-1',
        title: 'Test Task',
        description: 'Test Description',
        status: 'completed',
        createdAt: '2026-02-01T10:00:00Z',
        priority: 'medium',
        retryCount: 0,
      })

      vi.mocked(getTaskFolder).mockReturnValue('/data/tasks/task-1')

      vi.mocked(getTaskWorkflow).mockReturnValue({
        id: 'wf-1',
        taskId: 'task-1',
        name: 'Test Workflow',
        description: 'Test workflow',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'node-1', type: 'task', name: 'Task Node 1', task: { persona: 'dev', prompt: 'Do something' } },
          { id: 'node-2', type: 'task', name: 'Task Node 2', task: { persona: 'dev', prompt: 'Do something else' } },
          { id: 'end', type: 'end', name: 'End' },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'node-1' },
          { id: 'e2', from: 'node-1', to: 'node-2' },
          { id: 'e3', from: 'node-2', to: 'end' },
        ],
        variables: {},
        createdAt: '2026-02-01T10:00:00Z',
      })

      vi.mocked(getTaskInstance).mockReturnValue({
        id: 'inst-1',
        workflowId: 'wf-1',
        status: 'completed',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T10:05:00Z',
        nodeStates: {
          'start': { status: 'done', attempts: 0 },
          'node-1': { status: 'done', attempts: 1 },
          'node-2': { status: 'done', attempts: 1 },
          'end': { status: 'done', attempts: 0 },
        },
        variables: {},
        outputs: {
          'node-1': 'Result 1',
          'node-2': 'Result 2',
        },
        loopCounts: {},
      })

      vi.mocked(getExecutionStats).mockReturnValue({
        summary: {
          taskId: 'task-1',
          workflowId: 'wf-1',
          instanceId: 'inst-1',
          workflowName: 'Test Workflow',
          status: 'completed',
          startedAt: '2026-02-01T10:00:00Z',
          completedAt: '2026-02-01T10:05:00Z',
          lastUpdatedAt: '2026-02-01T10:05:00Z',
          totalDurationMs: 300000,
          totalCostUsd: 0.15,
          nodesTotal: 2,
          nodesCompleted: 2,
          nodesFailed: 0,
          nodesRunning: 0,
          avgNodeDurationMs: 150000,
        },
        nodes: [
          { nodeId: 'node-1', nodeName: 'Task Node 1', nodeType: 'task', status: 'completed', attempts: 1, durationMs: 120000, costUsd: 0.08 },
          { nodeId: 'node-2', nodeName: 'Task Node 2', nodeType: 'task', status: 'completed', attempts: 1, durationMs: 180000, costUsd: 0.07 },
        ],
      })

      vi.mocked(getExecutionTimeline).mockReturnValue([
        { timestamp: '2026-02-01T10:00:00Z', event: 'workflow:started' },
        { timestamp: '2026-02-01T10:00:01Z', event: 'node:started', nodeId: 'node-1', nodeName: 'Task Node 1' },
        { timestamp: '2026-02-01T10:02:00Z', event: 'node:completed', nodeId: 'node-1', nodeName: 'Task Node 1' },
        { timestamp: '2026-02-01T10:02:01Z', event: 'node:started', nodeId: 'node-2', nodeName: 'Task Node 2' },
        { timestamp: '2026-02-01T10:05:00Z', event: 'node:completed', nodeId: 'node-2', nodeName: 'Task Node 2' },
        { timestamp: '2026-02-01T10:05:00Z', event: 'workflow:completed' },
      ])


      const report = generateExecutionReport('task-1')

      expect(report).not.toBeNull()
      expect(report!.version).toBe('1.0')
      expect(report!.task.id).toBe('task-1')
      expect(report!.task.title).toBe('Test Task')
      expect(report!.execution.status).toBe('completed')
      expect(report!.nodes).toHaveLength(2)
      expect(report!.summary.completedNodes).toBe(2)
      expect(report!.summary.successRate).toBe(100)
    })

    it('should handle failed nodes correctly', () => {
      vi.mocked(getTask).mockReturnValue({
        id: 'task-2',
        title: 'Failed Task',
        description: 'A task that failed',
        status: 'failed',
        createdAt: '2026-02-01T10:00:00Z',
        priority: 'medium',
        retryCount: 0,
      })

      vi.mocked(getTaskFolder).mockReturnValue('/data/tasks/task-2')

      vi.mocked(getTaskWorkflow).mockReturnValue({
        id: 'wf-2',
        taskId: 'task-2',
        name: 'Failed Workflow',
        description: 'Workflow that fails',
        nodes: [
          { id: 'start', type: 'start', name: 'Start' },
          { id: 'node-1', type: 'task', name: 'Failing Node', task: { persona: 'dev', prompt: 'Fail' } },
          { id: 'end', type: 'end', name: 'End' },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'node-1' },
          { id: 'e2', from: 'node-1', to: 'end' },
        ],
        variables: {},
        createdAt: '2026-02-01T10:00:00Z',
      })

      vi.mocked(getTaskInstance).mockReturnValue({
        id: 'inst-2',
        workflowId: 'wf-2',
        status: 'failed',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T10:01:00Z',
        error: 'Node failed: Failing Node',
        nodeStates: {
          'start': { status: 'done', attempts: 0 },
          'node-1': { status: 'failed', attempts: 3, error: 'Timeout exceeded' },
          'end': { status: 'pending', attempts: 0 },
        },
        variables: {},
        outputs: {},
        loopCounts: {},
      })

      vi.mocked(getExecutionStats).mockReturnValue(null)
      vi.mocked(getExecutionTimeline).mockReturnValue([])

      const report = generateExecutionReport('task-2')

      expect(report).not.toBeNull()
      expect(report!.execution.status).toBe('failed')
      expect(report!.nodes).toHaveLength(1) // Only task node, excluding start/end
      expect(report!.nodes[0]!.status).toBe('failed')
      expect(report!.nodes[0]!.error).toBe('Timeout exceeded')
      expect(report!.summary.failedNodes).toBe(1)
      expect(report!.summary.successRate).toBe(0)
    })
  })

  describe('formatReportForTerminal', () => {
    it('should format a report for terminal output', () => {
      const report: ExecutionReport = {
        version: '1.0',
        generatedAt: '2026-02-01T10:10:00Z',
        task: {
          id: 'task-1',
          title: 'Test Task',
          description: 'Test Description',
          status: 'completed',
          createdAt: '2026-02-01T10:00:00Z',
        },
        execution: {
          workflowId: 'wf-1',
          instanceId: 'inst-1',
          status: 'completed',
          startedAt: '2026-02-01T10:00:00Z',
          completedAt: '2026-02-01T10:05:00Z',
          totalDurationMs: 300000,
          totalCostUsd: 0.15,
        },
        nodes: [
          { id: 'node-1', name: 'Task Node 1', type: 'task', status: 'completed', attempts: 1, durationMs: 150000, costUsd: 0.08 },
          { id: 'node-2', name: 'Task Node 2', type: 'task', status: 'completed', attempts: 1, durationMs: 150000, costUsd: 0.07 },
        ],
        timeline: [
          { timestamp: '2026-02-01T10:00:00Z', event: 'workflow:started' },
          { timestamp: '2026-02-01T10:05:00Z', event: 'workflow:completed' },
        ],
        summary: {
          totalNodes: 2,
          completedNodes: 2,
          failedNodes: 0,
          skippedNodes: 0,
          successRate: 100,
          avgNodeDurationMs: 150000,
          totalCostUsd: 0.15,
        },
      }

      const output = formatReportForTerminal(report)

      expect(output).toContain('执行报告: Test Task')
      expect(output).toContain('状态: ✅ 已完成')
      expect(output).toContain('总节点数: 2')
      expect(output).toContain('已完成: 2')
      expect(output).toContain('Task Node 1')
      expect(output).toContain('Task Node 2')
    })

    it('should show errors for failed nodes', () => {
      const report: ExecutionReport = {
        version: '1.0',
        generatedAt: '2026-02-01T10:10:00Z',
        task: {
          id: 'task-1',
          title: 'Failed Task',
          description: '',
          status: 'failed',
          createdAt: '2026-02-01T10:00:00Z',
        },
        execution: {
          workflowId: 'wf-1',
          instanceId: 'inst-1',
          status: 'failed',
          startedAt: '2026-02-01T10:00:00Z',
          totalDurationMs: 60000,
          totalCostUsd: 0.05,
        },
        nodes: [
          { id: 'node-1', name: 'Failing Node', type: 'task', status: 'failed', attempts: 3, error: 'Connection timeout' },
        ],
        timeline: [],
        summary: {
          totalNodes: 1,
          completedNodes: 0,
          failedNodes: 1,
          skippedNodes: 0,
          successRate: 0,
          avgNodeDurationMs: 0,
          totalCostUsd: 0.05,
        },
      }

      const output = formatReportForTerminal(report)

      expect(output).toContain('失败')
      expect(output).toContain('Failing Node')
      expect(output).toContain('Connection timeout')
    })
  })

  describe('formatReportForMarkdown', () => {
    it('should format a report as markdown', () => {
      const report: ExecutionReport = {
        version: '1.0',
        generatedAt: '2026-02-01T10:10:00Z',
        task: {
          id: 'task-1',
          title: 'Test Task',
          description: 'Test Description',
          status: 'completed',
          createdAt: '2026-02-01T10:00:00Z',
        },
        execution: {
          workflowId: 'wf-1',
          instanceId: 'inst-1',
          status: 'completed',
          startedAt: '2026-02-01T10:00:00Z',
          completedAt: '2026-02-01T10:05:00Z',
          totalDurationMs: 300000,
          totalCostUsd: 0.15,
        },
        nodes: [
          { id: 'node-1', name: 'Task Node', type: 'task', status: 'completed', attempts: 1 },
        ],
        timeline: [],
        summary: {
          totalNodes: 1,
          completedNodes: 1,
          failedNodes: 0,
          skippedNodes: 0,
          successRate: 100,
          avgNodeDurationMs: 150000,
          totalCostUsd: 0.15,
        },
      }

      const output = formatReportForMarkdown(report)

      expect(output).toContain('# 执行报告: Test Task')
      expect(output).toContain('## 任务信息')
      expect(output).toContain('## 执行信息')
      expect(output).toContain('## 执行汇总')
      expect(output).toContain('## 节点详情')
      expect(output).toContain('| 节点 | 类型 | 状态 | 耗时 | 成本 |')
      expect(output).toContain('Task Node')
    })

    it('should include error section for failed nodes', () => {
      const report: ExecutionReport = {
        version: '1.0',
        generatedAt: '2026-02-01T10:10:00Z',
        task: {
          id: 'task-1',
          title: 'Failed Task',
          description: '',
          status: 'failed',
          createdAt: '2026-02-01T10:00:00Z',
        },
        execution: {
          workflowId: 'wf-1',
          instanceId: 'inst-1',
          status: 'failed',
          startedAt: '2026-02-01T10:00:00Z',
          totalDurationMs: 60000,
          totalCostUsd: 0.05,
        },
        nodes: [
          { id: 'node-1', name: 'Failing Node', type: 'task', status: 'failed', attempts: 3, error: 'API Error: rate limit' },
        ],
        timeline: [],
        summary: {
          totalNodes: 1,
          completedNodes: 0,
          failedNodes: 1,
          skippedNodes: 0,
          successRate: 0,
          avgNodeDurationMs: 0,
          totalCostUsd: 0.05,
        },
      }

      const output = formatReportForMarkdown(report)

      expect(output).toContain('### 错误详情')
      expect(output).toContain('#### Failing Node')
      expect(output).toContain('API Error: rate limit')
    })
  })
})
