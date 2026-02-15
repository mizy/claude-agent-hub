/**
 * @entry Prompt Optimization 模块
 *
 * 自动分析任务失败原因，生成改进版 prompt，管理 prompt 版本生命周期。
 *
 * 主要 API:
 * - analyzeFailure(): 分析失败任务，判断是否与 prompt 质量相关
 * - generateImprovement(): 基于失败分析生成改进版 prompt
 * - saveNewVersion(): 保存新的 prompt 版本
 * - getActivePrompt(): 获取 persona 当前活跃版本的 prompt
 * - rollbackVersion(): 回滚到指定版本
 * - recordUsage(): 记录版本使用结果（成功/失败/耗时）
 */

// ============ 失败分析 ============

export { analyzeFailure } from './analyzeFailure.js'

// ============ 改进生成 ============

export { generateImprovement } from './generateImprovement.js'

// ============ 版本管理 ============

export {
  saveNewVersion,
  getActivePrompt,
  rollbackVersion,
  recordUsage,
} from './manageVersions.js'
