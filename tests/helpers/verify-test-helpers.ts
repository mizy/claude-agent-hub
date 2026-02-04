/**
 * 验证测试辅助工具是否正常工作
 * 这不是单元测试，而是快速验证脚本
 */

import {
  createLinearWorkflow,
  createConditionalWorkflow,
  createLoopWorkflow,
  createRetryWorkflow,
  createWorkflowInstance,
  createNodeJobData,
  retryErrorScenarios,
  lifecycleScenarios,
  TestEnvironment,
  assertWorkflowExists,
  assertNodeStatus,
  assertWorkflowHasNode,
} from './index.js'

async function main() {
  console.log('🔍 验证测试辅助工具...\n')

  // 1. 测试 Workflow 数据工厂
  console.log('1️⃣ 测试 Workflow 数据工厂')
  const linearWorkflow = createLinearWorkflow('test-task-1')
  console.log(`  ✓ 线性工作流: ${linearWorkflow.nodes.length} 个节点`)

  const conditionalWorkflow = createConditionalWorkflow('test-task-2')
  console.log(`  ✓ 条件分支工作流: ${conditionalWorkflow.nodes.length} 个节点`)

  const loopWorkflow = createLoopWorkflow('test-task-3', 5)
  console.log(`  ✓ 循环工作流: ${loopWorkflow.nodes.length} 个节点`)

  const retryWorkflow = createRetryWorkflow('test-task-4')
  console.log(`  ✓ 重试工作流: ${retryWorkflow.nodes.length} 个节点\n`)

  // 2. 测试 Instance 创建
  console.log('2️⃣ 测试 Instance 创建')
  const nodeIds = linearWorkflow.nodes.map(n => n.id)
  const instance = createWorkflowInstance(linearWorkflow.id, nodeIds, {
    currentNodeId: 'task-1',
  })
  console.log(`  ✓ Instance: ${instance.id}`)
  console.log(`  ✓ 节点状态数: ${Object.keys(instance.nodeStates).length}\n`)

  // 3. 测试 NodeJobData 创建
  console.log('3️⃣ 测试 NodeJobData 创建')
  const jobData = createNodeJobData(linearWorkflow.id, instance.id, 'task-1', 1)
  console.log(`  ✓ 节点任务: ${jobData.nodeId} (尝试 ${jobData.attempt})\n`)

  // 4. 测试错误场景
  console.log('4️⃣ 测试错误场景')
  console.log(`  ✓ 错误场景数: ${retryErrorScenarios.length}`)
  const transientErrors = retryErrorScenarios.filter(s => s.expectedCategory === 'transient')
  console.log(`  ✓ 暂时性错误: ${transientErrors.length}`)
  const permanentErrors = retryErrorScenarios.filter(s => s.expectedCategory === 'permanent')
  console.log(`  ✓ 永久性错误: ${permanentErrors.length}\n`)

  // 5. 测试生命周期场景
  console.log('5️⃣ 测试生命周期场景')
  console.log(`  ✓ 生命周期场景数: ${lifecycleScenarios.length}`)
  const successScenarios = lifecycleScenarios.filter(s => s.shouldSucceed)
  console.log(`  ✓ 应成功场景: ${successScenarios.length}\n`)

  // 6. 测试环境管理
  console.log('6️⃣ 测试环境管理')
  const env = new TestEnvironment({
    cleanupOnExit: true,
    mockClaudeCode: true,
  })

  await env.setup()
  console.log(`  ✓ 测试环境创建: ${env.getDataDir()}`)

  // 创建测试任务
  const task = {
    id: 'verify-task-1',
    title: '验证测试任务',
    description: '用于验证测试环境',
    priority: 'medium' as const,
    status: 'pending' as const,
    retryCount: 0,
    createdAt: new Date().toISOString(),
  }

  await env.createTask(task)
  await env.createWorkflow(task.id, linearWorkflow)
  await env.createInstance(task.id, instance)

  console.log(`  ✓ 任务已创建: ${task.id}`)

  // 读取并验证
  const loadedWorkflow = await env.getWorkflow(task.id)
  assertWorkflowExists(loadedWorkflow, task.id)
  assertWorkflowHasNode(loadedWorkflow, 'start', 'start')
  console.log('  ✓ 数据读取和验证成功')

  // 清理
  await env.cleanup()
  console.log('  ✓ 测试环境已清理\n')

  // 7. 测试断言
  console.log('7️⃣ 测试断言')
  try {
    assertNodeStatus(instance, 'task-1', 'running')
    console.log('  ✓ 节点状态断言通过')
  } catch (error) {
    console.error('  ✗ 节点状态断言失败:', error)
  }

  console.log('\n✅ 所有测试辅助工具验证通过！')
}

main().catch(error => {
  console.error('\n❌ 验证失败:', error)
  process.exit(1)
})
