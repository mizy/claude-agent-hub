/**
 * @entry Prompts 提示词模块
 *
 * 任务执行 / 对话相关的提示词模板
 * 注意：Agent 人格的 prompt 定义在 src/persona/builtinPersonas.ts
 */

export {
  TASK_PROMPTS,
  buildJsonWorkflowPrompt,
  buildExecuteNodePrompt,
  buildGenerateTitleFromWorkflowPrompt,
} from './taskPrompts.js'

export { buildClientPrompt } from './chatPrompts.js'

export { buildMemoryExtractionPrompt } from './memoryPrompts.js'
export type { TaskSummary } from './memoryPrompts.js'
