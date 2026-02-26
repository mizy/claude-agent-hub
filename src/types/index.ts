/**
 * @entry Types 类型定义模块
 *
 * 所有共享类型的统一导出入口。
 *
 * 按领域分组：
 * - task: 任务元数据、状态、创建选项
 * - workflow: 工作流定义、节点、实例、运行时状态
 * - persona: AI 人格配置
 * - output: 输出相关类型
 * - trace: 追踪/可观测性类型
 */

// Task types
export type {
  Task,
  TaskStatus,
  TaskPriority,
  CreateTaskOptions,
  TaskOutput,
} from './task.js'

// Task parse helpers
export { parseTaskPriority, parseTaskStatus } from './task.js'

// Task status helpers
export {
  isTerminalStatus,
  isActiveStatus,
  isRunningStatus,
  isPendingStatus,
  isCompletedStatus,
  isFailedStatus,
  isCancelledStatus,
  isReviewingStatus,
  isStoppableStatus,
  isPausedStatus,
  isPausableStatus,
  isWaitingStatus,
} from './taskStatus.js'

// Workflow types
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
  NodeJobData,
  NodeJobResult,
  EvalContext,
  WorkflowEventType,
  WorkflowEvent,
  ExecuteNodeResult,
  NodeExecutionStats,
  WorkflowExecutionStats,
} from './workflow.js'

// Node/Workflow status helpers
export {
  isNodeDone,
  isNodeRunning,
  isNodeFailed,
  isNodeWaiting,
  isNodeSkipped,
  isWorkflowTerminal,
  isWorkflowRunning,
  isWorkflowCompleted,
  isWorkflowFailed,
  isWorkflowPaused,
} from './nodeStatus.js'

// Persona types
export type { PersonaConfig, PersonaTraits, PersonaPreferences } from './persona.js'

// Output types
export type { ExecutionTiming } from './output.js'

// Task message types
export type { TaskMessage, TaskMessageSource } from './taskMessage.js'

// Prompt version types
export type { PromptVersion, FailureAnalysis, PromptVersionStats } from './promptVersion.js'

// Trace types
export type {
  Span,
  SpanKind,
  SpanStatus,
  SpanAttributes,
  Trace,
  TraceFile,
  OTLPSpanMapping,
  OTLPSpanKind,
  OTLPStatus,
  OTLPAttribute,
  TraceContext,
} from './trace.js'

// Episode types (episodic memory)
export type {
  Episode,
  EpisodeIndexEntry,
  EpisodeTone,
  EpisodePlatform,
} from '../memory/types.js'
