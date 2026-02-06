// DEPRECATED: 请使用 src/backend/ 模块
// 此文件仅为向后兼容保留
export {
  invokeBackend as invokeClaudeCode,
  checkBackendAvailable as checkClaudeAvailable,
  type InvokeOptions,
  type InvokeResult,
  type InvokeError,
} from '../backend/index.js'
