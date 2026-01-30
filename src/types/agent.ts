import type { PersonaConfig } from './persona.js'
import type { Task } from './task.js'

export type AgentStatus = 'idle' | 'working' | 'waiting'

export interface AgentStats {
  tasksCompleted: number
  tasksFailed: number
  totalWorkTime: number
}

export interface Agent {
  id: string
  name: string
  persona: string
  personaConfig?: PersonaConfig
  description: string
  status: AgentStatus
  currentTask?: string
  stats: AgentStats
  createdAt: string
}

export interface CreateAgentOptions {
  name: string
  persona: string
  description?: string
}

export interface AgentContext {
  agent: Agent
  task: Task
  branch: string
}
