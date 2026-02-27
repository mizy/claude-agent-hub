/**
 * Task Workflow Store - Task 的 Workflow 和 Instance 存储
 */

import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import type { Workflow, WorkflowInstance } from '../types/workflow.js'
import { WORKFLOW_FILE, INSTANCE_FILE, getTaskDir } from './paths.js'
import { readJson, writeJson } from './readWriteJson.js'
import { getTaskFolder } from './TaskStore.js'

const logger = createLogger('task-workflow-store')

// ============ Workflow in Task Folder ============

// Save workflow to task folder
export function saveTaskWorkflow(taskId: string, workflow: Workflow): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJson(join(taskDir, WORKFLOW_FILE), workflow)
  logger.debug(`Saved workflow for task: ${taskId}`)
}

// Get workflow from task folder
export function getTaskWorkflow(taskId: string): Workflow | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<Workflow>(join(taskDir, WORKFLOW_FILE))
}

// Save workflow instance to task folder
export function saveTaskInstance(taskId: string, instance: WorkflowInstance): void {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) {
    logger.warn(`Task folder not found for: ${taskId}`)
    return
  }
  writeJson(join(taskDir, INSTANCE_FILE), instance)
}

// Get workflow instance from task folder
export function getTaskInstance(taskId: string): WorkflowInstance | null {
  const taskDir = getTaskFolder(taskId)
  if (!taskDir) return null
  return readJson<WorkflowInstance>(join(taskDir, INSTANCE_FILE))
}

// ============ Path Helpers ============

// Get workflow file path
export function getWorkflowPath(taskId: string): string {
  return join(getTaskDir(taskId), WORKFLOW_FILE)
}

// Get instance file path
export function getInstancePath(taskId: string): string {
  return join(getTaskDir(taskId), INSTANCE_FILE)
}

