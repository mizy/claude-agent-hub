/**
 * Output module - Task output saving and title generation
 */

export { generateTaskTitle, isGenericTitle } from './generateTaskTitle.js'
export {
  saveWorkflowOutput,
  formatDuration,
  calculateTotalDuration,
  formatNodeState,
  formatWorkflowOutput,
  type WorkflowExecutionResult,
  type SaveOptions,
} from './saveWorkflowOutput.js'
