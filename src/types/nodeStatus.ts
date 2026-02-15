/**
 * 节点状态类型安全辅助函数
 *
 * 提供类型安全的节点状态判断，避免字符串字面量散落在代码各处
 */

import type { NodeStatus, WorkflowStatus } from './workflow.js'

// ============ NodeStatus 辅助函数 ============

/**
 * 判断节点是否已完成（done 或 skipped）
 */
export function isNodeDone(status: NodeStatus): boolean {
  return status === 'done' || status === 'skipped'
}

/**
 * 判断节点是否正在运行
 */
export function isNodeRunning(status: NodeStatus): boolean {
  return status === 'running'
}

/**
 * 判断节点是否失败
 */
export function isNodeFailed(status: NodeStatus): boolean {
  return status === 'failed'
}

/**
 * 判断节点是否等待中（pending 或 ready）
 */
export function isNodeWaiting(status: NodeStatus): boolean {
  return status === 'pending' || status === 'ready'
}

/**
 * 判断节点是否已跳过
 */
export function isNodeSkipped(status: NodeStatus): boolean {
  return status === 'skipped'
}

// ============ WorkflowStatus 辅助函数 ============

/**
 * 判断工作流是否已终结（completed, failed, cancelled）
 */
export function isWorkflowTerminal(status: WorkflowStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * 判断工作流是否正在运行
 */
export function isWorkflowRunning(status: WorkflowStatus): boolean {
  return status === 'running'
}

/**
 * 判断工作流是否已完成（成功）
 */
export function isWorkflowCompleted(status: WorkflowStatus): boolean {
  return status === 'completed'
}

/**
 * 判断工作流是否失败
 */
export function isWorkflowFailed(status: WorkflowStatus): boolean {
  return status === 'failed'
}

/**
 * 判断工作流是否暂停
 */
export function isWorkflowPaused(status: WorkflowStatus): boolean {
  return status === 'paused'
}
