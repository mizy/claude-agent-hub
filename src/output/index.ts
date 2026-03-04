/**
 * @entry Output 输出模块
 *
 * 任务输出保存与标题生成
 *
 * 主要 API:
 * - generateTaskTitle / isGenericTitle: 标题生成与判断
 * - saveWorkflowOutput / formatWorkflowOutput / calculateTotalDuration / formatNodeState: 输出保存与格式化
 * - readOutputSummary: 读取已保存的输出摘要
 * - WorkflowExecutionResult: 执行结果类型
 */

export { generateTaskTitle, isGenericTitle } from './generateTaskTitle.js'
export {
  saveWorkflowOutput,
  calculateTotalDuration,
  formatNodeState,
  formatWorkflowOutput,
  type WorkflowExecutionResult,
} from './saveWorkflowOutput.js'
export { readOutputSummary } from './readOutputSummary.js'
