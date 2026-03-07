/**
 * @entry Prompts 提示词模块
 *
 * 任务执行 / 对话相关的提示词模板
 * 注意：Agent 人格的 prompt 定义在 src/agents/builtinAgents.ts
 *
 * 公共 API:
 * - TASK_PROMPTS: 任务提示词常量
 * - buildJsonWorkflowPrompt / buildExecuteNodePrompt / buildGenerateTitleFromWorkflowPrompt: 任务模板
 * - buildClientPrompt: 对话模板
 * - buildMemoryExtractionPrompt: 记忆提取模板
 */

export {
  TASK_PROMPTS,
  buildJsonWorkflowPrompt,
  buildExecuteNodePrompt,
  buildGenerateTitleFromWorkflowPrompt,
} from './taskPrompts.js'

export { buildClientPrompt } from './chatPrompts.js'
export type { PromptMode } from './chatPrompts.js'

export { buildMemoryExtractionPrompt } from './memoryPrompts.js'
export type { TaskSummary } from './memoryPrompts.js'
