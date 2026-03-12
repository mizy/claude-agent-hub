/**
 * Idempotently create or resume the selfdrive-master workflow
 */

import { createLogger } from '../shared/logger.js'
import { getAllTasks } from '../store/TaskStore.js'
import { createTaskWithFolder } from '../task/createTaskWithFolder.js'
import { parseJson } from '../workflow/parser/parseJson.js'
import { saveTaskWorkflow } from '../store/TaskWorkflowStore.js'
import { spawnTaskRunner } from '../task/spawnTask.js'
import { getGoalPrompt } from './buildGoalPrompt.js'

const logger = createLogger('selfdrive')

const WORKFLOW_SLUG = 'selfdrive-master'
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'stopped'])

export async function ensureSelfDriveWorkflow(): Promise<void> {
  // 1. Check if already running
  const existing = getAllTasks().find(
    t =>
      t.source === 'selfdrive' &&
      t.metadata?.workflowSlug === WORKFLOW_SLUG &&
      !TERMINAL_STATUSES.has(t.status),
  )

  if (existing) {
    logger.info(`selfdrive-master already active: ${existing.id} (${existing.status})`)
    return
  }

  // 2. Create task
  const task = createTaskWithFolder({
    description: '自驱系统主循环：每日自动执行进化、灵感采集、代码清理、文档更新',
    title: '自驱系统 (selfdrive-master)',
    source: 'selfdrive',
    metadata: { workflowSlug: WORKFLOW_SLUG },
    schedule: '0 3 * * *',
  })

  // 3. Build workflow
  const fallbackPrompt = (goalType: string) =>
    getGoalPrompt(goalType) ?? `执行 ${goalType} 目标`

  const workflowInput = {
    name: '自驱系统 (selfdrive-master)',
    description: '每日凌晨3点执行自进化、灵感采集、代码清理、文档更新',
    nodes: [
      { id: 'start', type: 'start' as const, name: '开始' },
      {
        id: 'wait',
        type: 'schedule-wait' as const,
        name: '每日凌晨3点',
        scheduleWait: { cron: '0 3 * * *', timezone: 'Asia/Shanghai' },
      },
      {
        id: 'evolve',
        type: 'task' as const,
        name: '自进化',
        task: { agent: 'auto', prompt: fallbackPrompt('evolve') },
      },
      {
        id: 'evolve_feature',
        type: 'task' as const,
        name: '灵感采集',
        task: { agent: 'auto', prompt: fallbackPrompt('evolve-feature') },
      },
      {
        id: 'cleanup_code',
        type: 'task' as const,
        name: '代码清理',
        task: { agent: 'auto', prompt: fallbackPrompt('cleanup-code') },
      },
      {
        id: 'update_docs',
        type: 'task' as const,
        name: '文档更新',
        task: { agent: 'auto', prompt: fallbackPrompt('update-docs') },
      },
      {
        id: 'notify',
        type: 'lark-notify' as const,
        name: '推送今日自驱结果',
        larkNotify: { title: '🤖 每日自驱执行报告' },
      },
    ],
    edges: [
      { from: 'start', to: 'wait' },
      { from: 'wait', to: 'evolve' },
      { from: 'evolve', to: 'evolve_feature' },
      { from: 'evolve_feature', to: 'cleanup_code' },
      { from: 'cleanup_code', to: 'update_docs' },
      { from: 'update_docs', to: 'notify' },
      { from: 'notify', to: 'wait', maxLoops: 500 },
    ],
    variables: {},
  }

  const workflow = parseJson(workflowInput)
  workflow.taskId = task.id
  saveTaskWorkflow(task.id, workflow)

  logger.info(`selfdrive-master workflow created: ${task.id}`)

  // 4. Start runner
  spawnTaskRunner()
  logger.info('selfdrive-master queued, runner started')
}
