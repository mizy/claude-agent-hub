/**
 * @entry 测试辅助工具统一导出
 *
 * 提供完整的测试基础设施：
 * - 测试数据工厂 (test-data, workflow-test-data)
 * - 测试环境管理 (test-env)
 * - 并发测试工具 (concurrency)
 * - 断言辅助函数 (test-assertions)
 */

// ============ 测试数据工厂 ============
export {
  createMediumTestTask,
  createTestWorkflow,
  createTestWorkflowInstance,
  createComplexTestWorkflow,
  createBatchTestTasks,
  createConcurrentTestTasks,
  createConcurrentTaskDescriptions,
  validateConcurrentCreation,
  getTestConfig,
  concurrentTestScenarios,
  type TestConfig,
  type ConcurrentTestScenario,
  type TaskCreationResult,
} from './test-data.js'

// ============ Workflow 测试数据 ============
export {
  createTaskNode,
  createConditionNode,
  createLoopNode,
  createLinearWorkflow,
  createConditionalWorkflow,
  createLoopWorkflow,
  createRetryWorkflow,
  createWorkflowInstance,
  createNodeJobData,
  createMockError,
  createTaskWithStatus,
  retryErrorScenarios,
  lifecycleScenarios,
  type ErrorScenario,
  type LifecycleScenario,
} from './workflow-test-data.js'

// ============ 测试环境管理 ============
export {
  TestEnvironment,
  MockClaudeCode,
  setupTestEnv,
  cleanupTestEnv,
  waitForCondition,
  sleep,
  createTestHooks,
  type TestEnvConfig,
} from './test-env.js'

// ============ 并发测试工具 ============
export {
  TestDataDir,
  runConcurrent,
  runCLIConcurrent,
  createStaleLock,
  PerfTimer,
  analyzeConcurrencyResults,
  waitFor,
  type ConcurrencyStats,
} from './concurrency.js'

// ============ 测试断言 ============
export {
  assertTaskStatus,
  assertTaskExists,
  assertWorkflowExists,
  assertInstanceExists,
  assertNodeStatus,
  assertAllNodesCompleted,
  assertNodeExecutionOrder,
  assertNodeOutput,
  assertRetryAttempts,
  assertRetryAttemptsInRange,
  assertWorkflowHasNode,
  assertWorkflowEdge,
  assertExecutionStats,
  assertTimeInRange,
  assertArrayUnique,
  assertArrayNotEmpty,
  assertObjectHasKeys,
  assertErrorMatches,
  assertPerformance,
} from './test-assertions.js'
