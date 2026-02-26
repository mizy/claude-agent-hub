/**
 * Workflow 类型 re-export
 *
 * 纯类型定义已迁移到 types/workflow.ts（基础层）。
 * 此文件作为 re-export shim，保持所有现有 import 路径不变。
 */

// 所有纯类型从 types/ 层导入
export type {
  NodeType,
  NodeStatus,
  WorkflowStatus,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowInstance,
  NodeState,
  TaskConfig,
  ConditionConfig,
  HumanConfig,
  DelayConfig,
  ScheduleConfig,
  LoopConfig,
  SwitchConfig,
  AssignConfig,
  ScriptConfig,
  ForeachConfig,
  ScheduleWaitConfig,
  NodeJobData,
  NodeJobResult,
  EvalContext,
  WorkflowEventType,
  WorkflowEvent,
  ExecuteNodeResult,
  NodeExecutionStats,
  WorkflowExecutionStats,
} from '../types/workflow.js'

// Factory functions (runtime values, stay in workflow/)
export {
  WORKFLOW_FACTORY,
  createWorkflow,
  createTaskNode,
  createHumanNode,
  createEdge,
  createInitialNodeState,
  createInitialInstance,
} from './factory.js'
