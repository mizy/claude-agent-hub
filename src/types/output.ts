/**
 * Types for task execution output
 */

import type { Agent } from './agent.js'
import type { Task } from './task.js'
import type { Plan } from './plan.js'

export interface StepOutput {
  stepOrder: number
  action: string
  files: string[]
  output: string
  durationMs: number
}

export interface ExecutionTiming {
  startedAt: string
  completedAt: string
}

export interface TaskExecutionResult {
  task: Task
  agent: Agent
  branch: string
  plan: Plan
  stepOutputs: StepOutput[]
  timing: ExecutionTiming
}
