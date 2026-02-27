/**
 * @entry Types 类型定义模块
 *
 * 所有共享类型的统一导出入口
 *
 * 按领域分组：
 * - task: Task/TaskStatus/TaskPriority/CreateTaskOptions + parseTaskPriority/parseTaskStatus
 * - taskStatus: 12 个状态判断函数（isTerminalStatus/isActiveStatus/isRunningStatus/...）
 * - workflow: Workflow/WorkflowNode/WorkflowEdge/WorkflowInstance/NodeState + 配置类型
 * - nodeStatus: 10 个节点/工作流状态判断函数（isNodeDone/isWorkflowTerminal/...）
 * - persona: PersonaConfig/PersonaTraits/PersonaPreferences
 * - output: ExecutionTiming
 * - taskMessage: TaskMessage/TaskMessageSource
 * - promptVersion: PromptVersion/FailureAnalysis/PromptVersionStats
 * - trace: Span/SpanKind/Trace/TraceContext/OTLP 映射类型
 * - episode: Episode/EpisodeIndexEntry（从 memory/types.js re-export）
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
