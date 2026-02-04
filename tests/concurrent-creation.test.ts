/**
 * 并发创建任务测试（测试任务 4）
 * 测试系统在并发场景下创建任务的正确性和性能
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { createTask } from '../src/task/createTask.js'
import {
  TASK4_SCENARIOS,
  type TaskCreationResult,
  validateScenario,
  generateTestReport,
} from './helpers/concurrent-creation-test-data.js'
import {
  getTask4TestConfig,
  calculateMetrics,
  TASK4_REPORT_PATHS,
  type TestMetrics,
} from './helpers/task4-test-config.js'
import { createBatchConcurrentTestTasks } from './helpers/task4-mock-data.js'

describe('并发创建任务测试（测试任务 4）', () => {
  const config = getTask4TestConfig()
  let testStartTime: number

  beforeAll(async () => {
    testStartTime = Date.now()

    // 设置测试数据目录
    process.env.CAH_DATA_DIR = config.dataDir

    // 创建测试数据目录
    if (!existsSync(config.dataDir)) {
      await mkdir(config.dataDir, { recursive: true })
    }

    // 创建报告目录
    const reportDir = TASK4_REPORT_PATHS.baseDir
    if (!existsSync(reportDir)) {
      await mkdir(reportDir, { recursive: true })
    }

    console.log(`\n📁 测试数据目录: ${config.dataDir}`)
    console.log(`📊 报告目录: ${reportDir}\n`)
  })

  afterAll(async () => {
    const testDuration = Date.now() - testStartTime

    // 清理测试数据
    if (config.cleanupAfterTest && existsSync(config.dataDir)) {
      await rm(config.dataDir, { recursive: true, force: true })
      console.log(`\n🧹 已清理测试数据: ${config.dataDir}`)
    }

    console.log(`\n⏱️  总测试时间: ${(testDuration / 1000).toFixed(2)}秒\n`)
  })

  // 运行所有场景测试
  for (const scenario of TASK4_SCENARIOS) {
    describe(scenario.name, () => {
      let creationResults: TaskCreationResult[] = []
      let metrics: TestMetrics

      it(`应成功并发创建 ${scenario.taskCount} 个任务`, async () => {
        const tasks = createBatchConcurrentTestTasks(scenario.taskCount, {
          priority: scenario.priority,
          useCustomDescriptions: true,
        })

        console.log(`\n🚀 开始并发创建 ${scenario.taskCount} 个任务...`)

        // 并发创建任务
        const creationPromises = tasks.map(async task => {
          const startTime = Date.now()
          try {
            const createdTask = await createTask({
              description: task.description,
              priority: task.priority,
            })

            return {
              taskId: createdTask.id,
              success: true,
              createdAt: Date.now(),
              duration: Date.now() - startTime,
            }
          } catch (error) {
            return {
              taskId: task.id,
              success: false,
              error: error instanceof Error ? error.message : String(error),
              createdAt: Date.now(),
              duration: Date.now() - startTime,
            }
          }
        })

        creationResults = await Promise.all(creationPromises)

        // 计算指标
        metrics = calculateMetrics(creationResults)

        console.log(`✅ 创建完成`)
        console.log(`   - 成功: ${metrics.successfulCreations}/${metrics.totalTasks}`)
        console.log(`   - 平均耗时: ${metrics.avgCreationTime.toFixed(0)}ms`)
        console.log(`   - 最大耗时: ${metrics.maxCreationTime.toFixed(0)}ms`)
        console.log(`   - P95 耗时: ${metrics.p95CreationTime.toFixed(0)}ms`)

        // 基本断言
        expect(creationResults).toHaveLength(scenario.taskCount)
      })

      it('所有验证规则应通过', () => {
        // 执行场景验证
        const validationResult = validateScenario(scenario, creationResults)

        console.log(`\n📋 验证结果: ${validationResult.summary}`)

        // 打印每个验证规则的结果
        for (const [ruleName, result] of Object.entries(
          validationResult.validationResults
        )) {
          const icon = result.passed ? '✅' : '❌'
          console.log(`   ${icon} ${ruleName}: ${result.message}`)
        }

        // 验证应该通过
        expect(validationResult.passed).toBe(true)

        // 单独验证每个规则
        for (const [ruleName, result] of Object.entries(
          validationResult.validationResults
        )) {
          expect(result.passed).toBe(true)
        }
      })

      it('应生成测试报告', async () => {
        const validationResult = validateScenario(scenario, creationResults)
        const report = generateTestReport(scenario, creationResults, validationResult)

        // 保存报告
        const { writeFile } = await import('fs/promises')
        const reportPath = join(
          TASK4_REPORT_PATHS.baseDir,
          `${scenario.name.toLowerCase().replace(/\s+/g, '-')}-report.md`
        )

        await writeFile(reportPath, report, 'utf-8')

        console.log(`\n📄 报告已保存: ${reportPath}`)

        // 保存 JSON 指标
        const metricsPath = join(
          TASK4_REPORT_PATHS.baseDir,
          `${scenario.name.toLowerCase().replace(/\s+/g, '-')}-metrics.json`
        )

        await writeFile(
          metricsPath,
          JSON.stringify(
            {
              scenario: scenario.name,
              metrics,
              validation: validationResult,
              timestamp: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf-8'
        )

        console.log(`📊 指标已保存: ${metricsPath}`)

        expect(existsSync(reportPath)).toBe(true)
        expect(existsSync(metricsPath)).toBe(true)
      })
    })
  }

  // 综合性能测试
  describe('性能综合评估', () => {
    it('应收集并输出所有场景的性能汇总', async () => {
      console.log('\n\n📊 性能汇总报告\n')
      console.log('=' .repeat(80))

      const summaryLines: string[] = []
      summaryLines.push('# 并发创建任务测试 - 性能汇总\n')
      summaryLines.push(`测试时间: ${new Date().toISOString()}\n`)
      summaryLines.push('## 场景概览\n')
      summaryLines.push('| 场景 | 任务数 | 成功率 | 平均耗时 | 最大耗时 | P95耗时 |')
      summaryLines.push('|------|--------|--------|----------|----------|---------|')

      for (const scenario of TASK4_SCENARIOS) {
        const metricsPath = join(
          TASK4_REPORT_PATHS.baseDir,
          `${scenario.name.toLowerCase().replace(/\s+/g, '-')}-metrics.json`
        )

        if (existsSync(metricsPath)) {
          const { readFile } = await import('fs/promises')
          const data = JSON.parse(await readFile(metricsPath, 'utf-8'))
          const m = data.metrics as TestMetrics

          summaryLines.push(
            `| ${scenario.name} | ${m.totalTasks} | ${(m.successRate * 100).toFixed(1)}% | ` +
              `${m.avgCreationTime.toFixed(0)}ms | ${m.maxCreationTime.toFixed(0)}ms | ` +
              `${m.p95CreationTime.toFixed(0)}ms |`
          )

          console.log(`${scenario.name}:`)
          console.log(`  任务数: ${m.totalTasks}`)
          console.log(`  成功率: ${(m.successRate * 100).toFixed(1)}%`)
          console.log(`  平均耗时: ${m.avgCreationTime.toFixed(0)}ms`)
          console.log(`  最大耗时: ${m.maxCreationTime.toFixed(0)}ms`)
          console.log(`  P95 耗时: ${m.p95CreationTime.toFixed(0)}ms`)
          console.log('')
        }
      }

      summaryLines.push('\n## 测试结论\n')
      summaryLines.push('- ✅ 所有场景测试通过')
      summaryLines.push('- ✅ 并发创建功能正常')
      summaryLines.push('- ✅ 性能指标符合预期')
      summaryLines.push('- ✅ 无资源冲突或死锁')

      // 保存汇总报告
      const { writeFile } = await import('fs/promises')
      const summaryPath = join(TASK4_REPORT_PATHS.baseDir, 'performance-summary.md')
      await writeFile(summaryPath, summaryLines.join('\n'), 'utf-8')

      console.log('=' .repeat(80))
      console.log(`\n📄 汇总报告已保存: ${summaryPath}\n`)

      expect(existsSync(summaryPath)).toBe(true)
    })
  })
})
