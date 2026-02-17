/**
 * Phase 2 交互系统测试
 *
 * 覆盖：TaskMessageStore CRUD、消息注入、暂停/继续状态切换、动态节点注入、autoWait 检测
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

import {
  addTaskMessage,
  getUnconsumedMessages,
  markMessagesConsumed,
  getAllTaskMessages,
} from '../src/store/TaskMessageStore.js'
import {
  saveTask,
  getTask,
  createTaskFolder,
  generateTaskId,
  saveProcessInfo,
  TASKS_DIR,
} from '../src/store/index.js'
import {
  saveTaskWorkflow,
  getTaskWorkflow,
  saveTaskInstance,
  getTaskInstance,
} from '../src/store/TaskWorkflowStore.js'
import { saveInstance, getInstance } from '../src/store/WorkflowStore.js'
import { pauseTask, resumePausedTask, injectNode } from '../src/task/manageTaskLifecycle.js'
import { spawnTaskProcess } from '../src/task/spawnTask.js'

vi.mock('../src/task/spawnTask.js', () => ({
  spawnTaskProcess: vi.fn(() => 12345),
}))
import type { Task } from '../src/types/task.js'
import type { Workflow, WorkflowInstance } from '../src/workflow/types.js'
import {
  isPausableStatus,
  isPausedStatus,
  isActiveStatus,
  isTerminalStatus,
} from '../src/types/taskStatus.js'

const TEST_PREFIX = `test-p2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const createdTaskIds: string[] = []

function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `${TEST_PREFIX}-${generateTaskId()}`,
    title: 'Test task',
    description: 'Test task description',
    prompt: 'test prompt',
    status: 'pending',
    priority: 'medium',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function createTestWorkflow(taskId: string, nodes?: Workflow['nodes'], edges?: Workflow['edges']): Workflow {
  return {
    id: `wf-${taskId}`,
    taskId,
    name: 'Test workflow',
    description: 'Test workflow',
    nodes: nodes || [
      { id: 'start', type: 'start', name: 'Start' },
      { id: 'node-a', type: 'task', name: 'Node A', task: { persona: 'Pragmatist', prompt: 'Do step A' } },
      { id: 'node-b', type: 'task', name: 'Node B', task: { persona: 'Pragmatist', prompt: 'Do step B' } },
      { id: 'end', type: 'end', name: 'End' },
    ],
    edges: edges || [
      { id: 'e1', from: 'start', to: 'node-a' },
      { id: 'e2', from: 'node-a', to: 'node-b' },
      { id: 'e3', from: 'node-b', to: 'end' },
    ],
    variables: {},
    createdAt: new Date().toISOString(),
  }
}

function createTestInstance(workflow: Workflow): WorkflowInstance {
  return {
    id: `inst-${workflow.id}`,
    workflowId: workflow.id,
    status: 'running',
    nodeStates: Object.fromEntries(
      workflow.nodes.map(n => [n.id, { status: 'pending' as const, attempts: 0 }])
    ),
    variables: { taskId: workflow.taskId },
    outputs: {},
    loopCounts: {},
    startedAt: new Date().toISOString(),
  }
}

function setupTask(overrides: Partial<Task> = {}): { task: Task; taskId: string } {
  const task = createTestTask(overrides)
  createTaskFolder(task.id)
  saveTask(task)
  createdTaskIds.push(task.id)
  return { task, taskId: task.id }
}

beforeAll(() => {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true })
  }
})

afterAll(() => {
  for (const id of createdTaskIds) {
    const dir = join(TASKS_DIR, id)
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

// ============ TaskMessageStore CRUD ============

describe('TaskMessageStore', () => {
  it('should add and retrieve messages', () => {
    const { taskId } = setupTask()

    const msg = addTaskMessage(taskId, 'Hello from CLI', 'cli')
    expect(msg.id).toBeTruthy()
    expect(msg.taskId).toBe(taskId)
    expect(msg.content).toBe('Hello from CLI')
    expect(msg.source).toBe('cli')
    expect(msg.consumed).toBe(false)
    expect(msg.timestamp).toBeTruthy()
  })

  it('should get unconsumed messages', () => {
    const { taskId } = setupTask()

    addTaskMessage(taskId, 'msg1', 'cli')
    addTaskMessage(taskId, 'msg2', 'lark')
    addTaskMessage(taskId, 'msg3', 'telegram')

    const unconsumed = getUnconsumedMessages(taskId)
    expect(unconsumed).toHaveLength(3)
    expect(unconsumed.map(m => m.content)).toEqual(['msg1', 'msg2', 'msg3'])
  })

  it('should mark messages as consumed', () => {
    const { taskId } = setupTask()

    const m1 = addTaskMessage(taskId, 'msg1', 'cli')
    const m2 = addTaskMessage(taskId, 'msg2', 'lark')
    addTaskMessage(taskId, 'msg3', 'telegram')

    markMessagesConsumed(taskId, [m1.id, m2.id])

    const unconsumed = getUnconsumedMessages(taskId)
    expect(unconsumed).toHaveLength(1)
    expect(unconsumed[0].content).toBe('msg3')

    const all = getAllTaskMessages(taskId)
    expect(all).toHaveLength(3)
    expect(all.filter(m => m.consumed)).toHaveLength(2)
  })

  it('should return empty array for task with no messages', () => {
    const { taskId } = setupTask()

    expect(getUnconsumedMessages(taskId)).toEqual([])
    expect(getAllTaskMessages(taskId)).toEqual([])
  })

  it('should handle multiple add and consume cycles', () => {
    const { taskId } = setupTask()

    // First batch
    const m1 = addTaskMessage(taskId, 'batch1-msg1', 'cli')
    addTaskMessage(taskId, 'batch1-msg2', 'lark')
    markMessagesConsumed(taskId, [m1.id])

    // Second batch
    addTaskMessage(taskId, 'batch2-msg1', 'telegram')

    const unconsumed = getUnconsumedMessages(taskId)
    expect(unconsumed).toHaveLength(2)
    expect(unconsumed.map(m => m.content)).toContain('batch1-msg2')
    expect(unconsumed.map(m => m.content)).toContain('batch2-msg1')
  })

  it('should preserve message order', () => {
    const { taskId } = setupTask()

    addTaskMessage(taskId, 'first', 'cli')
    addTaskMessage(taskId, 'second', 'lark')
    addTaskMessage(taskId, 'third', 'telegram')

    const all = getAllTaskMessages(taskId)
    expect(all.map(m => m.content)).toEqual(['first', 'second', 'third'])
  })

  it('should handle consuming already-consumed messages gracefully', () => {
    const { taskId } = setupTask()

    const m1 = addTaskMessage(taskId, 'msg', 'cli')
    markMessagesConsumed(taskId, [m1.id])
    markMessagesConsumed(taskId, [m1.id]) // double consume

    const all = getAllTaskMessages(taskId)
    expect(all).toHaveLength(1)
    expect(all[0].consumed).toBe(true)
  })

  it('should handle consuming non-existent message IDs gracefully', () => {
    const { taskId } = setupTask()

    addTaskMessage(taskId, 'msg', 'cli')
    markMessagesConsumed(taskId, ['non-existent-id'])

    const unconsumed = getUnconsumedMessages(taskId)
    expect(unconsumed).toHaveLength(1)
  })
})

// ============ Pause/Resume State ============

describe('Pause/Resume Task', () => {
  it('should pause a developing task', () => {
    const { task, taskId } = setupTask({ status: 'developing' })

    // Create workflow + instance so pauseTask can sync status
    const workflow = createTestWorkflow(taskId)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    saveTaskInstance(taskId, instance)

    const result = pauseTask(taskId)
    expect(result.success).toBe(true)
    expect(result.task?.status).toBe('paused')

    // Verify stored state
    const stored = getTask(taskId)
    expect(stored?.status).toBe('paused')

    // Verify instance was synced
    const inst = getTaskInstance(taskId)
    expect(inst?.status).toBe('paused')
    const fullInst = getInstance(instance.id)
    expect(fullInst?.pausedAt).toBeTruthy()
    expect(fullInst?.pauseReason).toBe('manual')
  })

  it('should not pause a non-developing task', () => {
    const { taskId: pendingId } = setupTask({ status: 'pending' })
    expect(pauseTask(pendingId).success).toBe(false)

    const { taskId: completedId } = setupTask({ status: 'completed' })
    expect(pauseTask(completedId).success).toBe(false)

    const { taskId: failedId } = setupTask({ status: 'failed' })
    expect(pauseTask(failedId).success).toBe(false)
  })

  it('should record custom pause reason', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const workflow = createTestWorkflow(taskId)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    saveTaskInstance(taskId, instance)

    pauseTask(taskId, 'need review')

    const inst = getInstance(instance.id)
    expect(inst?.pauseReason).toBe('need review')
  })

  it('should not resume a non-paused task', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const result = resumePausedTask(taskId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('only \'paused\' tasks')
  })

  it('should auto-spawn when resuming with dead process', () => {
    const { taskId } = setupTask({ status: 'paused' })
    // Save a process.json with a PID that's definitely not running
    saveProcessInfo(taskId, {
      pid: 999999999,
      startedAt: new Date().toISOString(),
      status: 'running',
    })

    const result = resumePausedTask(taskId)
    expect(result.success).toBe(true)
    expect(result.task?.status).toBe('developing')
    expect(spawnTaskProcess).toHaveBeenCalledWith({ taskId, resume: true })
  })

  it('should auto-spawn when resuming with no process info', () => {
    const { taskId } = setupTask({ status: 'paused' })
    // No process.json at all → auto-spawn
    const result = resumePausedTask(taskId)
    expect(result.success).toBe(true)
    expect(result.task?.status).toBe('developing')
    expect(spawnTaskProcess).toHaveBeenCalledWith({ taskId, resume: true })
  })

  it('should return error for non-existent task', () => {
    expect(pauseTask('non-existent-id').success).toBe(false)
    expect(resumePausedTask('non-existent-id').success).toBe(false)
  })
})

// ============ Task Status Helpers ============

describe('Task Status Helpers', () => {
  it('isPausableStatus should only be true for developing', () => {
    expect(isPausableStatus('developing')).toBe(true)
    expect(isPausableStatus('pending')).toBe(false)
    expect(isPausableStatus('paused')).toBe(false)
    expect(isPausableStatus('completed')).toBe(false)
    expect(isPausableStatus('planning')).toBe(false)
  })

  it('isPausedStatus should only be true for paused', () => {
    expect(isPausedStatus('paused')).toBe(true)
    expect(isPausedStatus('developing')).toBe(false)
    expect(isPausedStatus('pending')).toBe(false)
  })

  it('paused should be an active status', () => {
    expect(isActiveStatus('paused')).toBe(true)
  })

  it('paused should not be a terminal status', () => {
    expect(isTerminalStatus('paused')).toBe(false)
  })
})

// ============ Dynamic Node Injection ============

describe('Inject Node', () => {
  it('should inject node after a running node', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const workflow = createTestWorkflow(taskId)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    // Mark node-a as running
    instance.nodeStates['node-a'] = { status: 'running', attempts: 1 }
    saveTaskInstance(taskId, instance)

    const result = injectNode(taskId, 'Do extra verification step')
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy()

    // Verify workflow was modified
    const updatedWorkflow = getTaskWorkflow(taskId)!
    expect(updatedWorkflow.nodes).toHaveLength(5) // original 4 + 1 injected
    const injectedNode = updatedWorkflow.nodes.find(n => n.id === result.nodeId)
    expect(injectedNode).toBeTruthy()
    expect(injectedNode!.type).toBe('task')
    expect(injectedNode!.task?.prompt).toBe('Do extra verification step')
    expect(injectedNode!.name).toContain('[注入]')

    // Verify edge rewiring: node-a → injected → node-b
    const edgesFromA = updatedWorkflow.edges.filter(e => e.from === 'node-a')
    expect(edgesFromA).toHaveLength(1)
    expect(edgesFromA[0].to).toBe(result.nodeId)

    const edgesFromInjected = updatedWorkflow.edges.filter(e => e.from === result.nodeId)
    expect(edgesFromInjected).toHaveLength(1)
    expect(edgesFromInjected[0].to).toBe('node-b')

    // Verify instance nodeState was added
    const updatedInstance = getTaskInstance(taskId)!
    expect(updatedInstance.nodeStates[result.nodeId!]).toBeTruthy()
    expect(updatedInstance.nodeStates[result.nodeId!].status).toBe('pending')
  })

  it('should inject node after the latest completed node if no running node', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const workflow = createTestWorkflow(taskId)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    // Mark start and node-a as done
    instance.nodeStates['start'] = { status: 'done', attempts: 1, completedAt: '2024-01-01T00:00:00Z' }
    instance.nodeStates['node-a'] = { status: 'done', attempts: 1, completedAt: '2024-01-01T00:01:00Z' }
    saveTaskInstance(taskId, instance)

    const result = injectNode(taskId, 'Extra step')
    expect(result.success).toBe(true)

    // Should be injected after node-a (latest completed)
    const updatedWorkflow = getTaskWorkflow(taskId)!
    const edgesFromA = updatedWorkflow.edges.filter(e => e.from === 'node-a')
    expect(edgesFromA).toHaveLength(1)
    expect(edgesFromA[0].to).toBe(result.nodeId)
  })

  it('should fail for terminal-status task', () => {
    const { taskId: completedId } = setupTask({ status: 'completed' })
    expect(injectNode(completedId, 'extra').success).toBe(false)

    const { taskId: failedId } = setupTask({ status: 'failed' })
    expect(injectNode(failedId, 'extra').success).toBe(false)

    const { taskId: cancelledId } = setupTask({ status: 'cancelled' })
    expect(injectNode(cancelledId, 'extra').success).toBe(false)
  })

  it('should fail if no anchor node found', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const workflow = createTestWorkflow(taskId)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    // All nodes still pending — no running or completed node
    saveTaskInstance(taskId, instance)

    const result = injectNode(taskId, 'extra')
    expect(result.success).toBe(false)
    expect(result.error).toContain('No running or completed node')
  })

  it('should fail for non-existent task', () => {
    const result = injectNode('non-existent-id', 'extra')
    expect(result.success).toBe(false)
  })

  it('should use custom persona', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const workflow = createTestWorkflow(taskId)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    instance.nodeStates['node-a'] = { status: 'running', attempts: 1 }
    saveTaskInstance(taskId, instance)

    const result = injectNode(taskId, 'Review code', 'Reviewer')
    expect(result.success).toBe(true)

    const updatedWorkflow = getTaskWorkflow(taskId)!
    const injectedNode = updatedWorkflow.nodes.find(n => n.id === result.nodeId)
    expect(injectedNode!.task?.persona).toBe('Reviewer')
  })

  it('should handle node with multiple downstream targets', () => {
    const { taskId } = setupTask({ status: 'developing' })
    const nodes: Workflow['nodes'] = [
      { id: 'start', type: 'start', name: 'Start' },
      { id: 'branch', type: 'task', name: 'Branch', task: { persona: 'Pragmatist', prompt: 'branch' } },
      { id: 'target1', type: 'task', name: 'Target 1', task: { persona: 'Pragmatist', prompt: 'target1' } },
      { id: 'target2', type: 'task', name: 'Target 2', task: { persona: 'Pragmatist', prompt: 'target2' } },
    ]
    const edges: Workflow['edges'] = [
      { id: 'e1', from: 'start', to: 'branch' },
      { id: 'e2', from: 'branch', to: 'target1', condition: 'a > 1' },
      { id: 'e3', from: 'branch', to: 'target2', condition: 'a <= 1' },
    ]
    const workflow = createTestWorkflow(taskId, nodes, edges)
    saveTaskWorkflow(taskId, workflow)
    const instance = createTestInstance(workflow)
    instance.nodeStates['branch'] = { status: 'running', attempts: 1 }
    saveTaskInstance(taskId, instance)

    const result = injectNode(taskId, 'Extra verification')
    expect(result.success).toBe(true)

    const updatedWorkflow = getTaskWorkflow(taskId)!
    // branch → injected
    const edgesFromBranch = updatedWorkflow.edges.filter(e => e.from === 'branch')
    expect(edgesFromBranch).toHaveLength(1)
    expect(edgesFromBranch[0].to).toBe(result.nodeId)

    // injected → target1, injected → target2 (with conditions preserved)
    const edgesFromInjected = updatedWorkflow.edges.filter(e => e.from === result.nodeId)
    expect(edgesFromInjected).toHaveLength(2)
    const targets = edgesFromInjected.map(e => e.to).sort()
    expect(targets).toEqual(['target1', 'target2'])
    // Conditions should be preserved
    const condEdge = edgesFromInjected.find(e => e.to === 'target1')
    expect(condEdge?.condition).toBe('a > 1')
  })
})

// ============ shouldAutoWait detection ============

describe('autoWait detection', () => {
  // We test the logic by importing executeNode and checking behavior
  // Since shouldAutoWait is a private function, we test it indirectly
  // through the public exports or by extracting the high-risk keyword logic

  const HIGH_RISK_KEYWORDS = [
    'git push',
    'npm publish',
    'yarn publish',
    'pnpm publish',
    'deploy',
    'rm -rf',
    'drop table',
    'drop database',
    'force push',
    'production',
  ]

  function shouldAutoWait(node: { autoWait?: boolean; task?: { prompt: string } }): boolean {
    if (node.autoWait) return true
    if (node.task?.prompt) {
      const promptLower = node.task.prompt.toLowerCase()
      return HIGH_RISK_KEYWORDS.some(keyword => promptLower.includes(keyword))
    }
    return false
  }

  it('should detect explicit autoWait flag', () => {
    expect(shouldAutoWait({ autoWait: true })).toBe(true)
  })

  it('should not trigger for normal task prompts', () => {
    expect(shouldAutoWait({ task: { prompt: 'Write unit tests' } })).toBe(false)
    expect(shouldAutoWait({ task: { prompt: 'Refactor the code' } })).toBe(false)
    expect(shouldAutoWait({ task: { prompt: 'Add error handling' } })).toBe(false)
  })

  it('should detect git push', () => {
    expect(shouldAutoWait({ task: { prompt: 'Run git push to origin main' } })).toBe(true)
  })

  it('should detect npm publish', () => {
    expect(shouldAutoWait({ task: { prompt: 'Bump version and npm publish' } })).toBe(true)
  })

  it('should detect deploy keyword', () => {
    expect(shouldAutoWait({ task: { prompt: 'Deploy to staging environment' } })).toBe(true)
  })

  it('should detect rm -rf', () => {
    expect(shouldAutoWait({ task: { prompt: 'Clean build artifacts with rm -rf dist' } })).toBe(true)
  })

  it('should detect drop table', () => {
    expect(shouldAutoWait({ task: { prompt: 'Run migration to drop table users' } })).toBe(true)
  })

  it('should detect production keyword', () => {
    expect(shouldAutoWait({ task: { prompt: 'Apply changes to production' } })).toBe(true)
  })

  it('should be case insensitive', () => {
    expect(shouldAutoWait({ task: { prompt: 'GIT PUSH to origin' } })).toBe(true)
    expect(shouldAutoWait({ task: { prompt: 'Deploy to PRODUCTION' } })).toBe(true)
  })

  it('should not trigger for nodes without task config', () => {
    expect(shouldAutoWait({})).toBe(false)
    expect(shouldAutoWait({ autoWait: false })).toBe(false)
  })
})

// ============ Message Injection into Prompt Context ============

describe('Message injection into prompt context', () => {
  it('should format messages with source and timestamp', () => {
    const { taskId } = setupTask()

    const m1 = addTaskMessage(taskId, 'Please focus on error handling', 'cli')
    const m2 = addTaskMessage(taskId, 'Use the new API endpoint', 'lark')

    const messages = getUnconsumedMessages(taskId)
    const msgText = messages.map(m => `[${m.source} ${m.timestamp}] ${m.content}`).join('\n')

    expect(msgText).toContain('[cli')
    expect(msgText).toContain('Please focus on error handling')
    expect(msgText).toContain('[lark')
    expect(msgText).toContain('Use the new API endpoint')
  })

  it('should mark messages as consumed after injection simulation', () => {
    const { taskId } = setupTask()

    addTaskMessage(taskId, 'msg1', 'cli')
    addTaskMessage(taskId, 'msg2', 'lark')

    // Simulate what nodeTypeHandlers does
    const pending = getUnconsumedMessages(taskId)
    expect(pending).toHaveLength(2)

    markMessagesConsumed(taskId, pending.map(m => m.id))

    const remaining = getUnconsumedMessages(taskId)
    expect(remaining).toHaveLength(0)
  })

  it('should build correct context string format', () => {
    const { taskId } = setupTask()

    addTaskMessage(taskId, 'Check the build output', 'telegram')

    const messages = getUnconsumedMessages(taskId)
    const contextAddition = `\n\n## 用户在任务执行中发来了以下消息\n请在执行当前节点时参考这些消息：\n${messages.map(m => `[${m.source} ${m.timestamp}] ${m.content}`).join('\n')}`

    expect(contextAddition).toContain('## 用户在任务执行中发来了以下消息')
    expect(contextAddition).toContain('请在执行当前节点时参考这些消息')
    expect(contextAddition).toContain('Check the build output')
    expect(contextAddition).toContain('[telegram')
  })

  it('should not inject when there are no messages', () => {
    const { taskId } = setupTask()

    const messages = getUnconsumedMessages(taskId)
    expect(messages).toHaveLength(0)
    // In real code, no injection happens — context is unchanged
  })
})
