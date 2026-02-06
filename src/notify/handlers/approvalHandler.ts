/**
 * 平台无关的审批处理器
 * 合并 Telegram 和飞书的审批逻辑为统一实现
 */

import { createLogger } from '../../shared/logger.js'
import {
  getWaitingHumanJobs,
  resumeWaitingJob,
  markJobFailed,
} from '../../workflow/queue/WorkflowQueue.js'
import {
  markNodeDone,
  markNodeFailed as stateMarkNodeFailed,
} from '../../workflow/engine/StateManager.js'
import { handleNodeResult, getWorkflow } from '../../workflow/index.js'
import type { ParsedApproval, ApprovalResult } from './types.js'

const logger = createLogger('approval-handler')

/**
 * 解析审批指令（合并 Telegram 和飞书的模式）
 *
 * 支持的格式：
 * - /approve, /通过, /批准 [nodeId]  （Telegram 斜杠命令）
 * - /reject, /拒绝, /否决 [原因]     （Telegram 斜杠命令）
 * - 通过, approve, 批准, ok, yes      （飞书 @机器人 裸关键字）
 * - 通过 <nodeId>                      （飞书带节点 ID）
 * - 拒绝, reject, no, 否              （飞书 @机器人 裸关键字）
 * - 拒绝 <原因>                        （飞书带原因）
 */
export function parseApprovalCommand(text: string): ParsedApproval | null {
  // 移除 @mention（飞书场景）并 trim
  const clean = text.replace(/@[\w\u4e00-\u9fa5]+/g, '').trim()

  // Telegram 斜杠命令格式: /approve [nodeId] 或 /reject [reason]
  const slashApproveMatch = clean.match(/^\/(approve|通过|批准)(?:\s+(\S+))?$/i)
  if (slashApproveMatch) {
    return { action: 'approve', nodeId: slashApproveMatch[2] }
  }

  const slashRejectMatch = clean.match(/^\/(reject|拒绝|否决)(?:\s+(.+))?$/i)
  if (slashRejectMatch) {
    return { action: 'reject', reason: slashRejectMatch[2] }
  }

  // 裸关键字格式（飞书场景）: 通过, approve, ok, yes 等
  if (/^(通过|approve|批准|ok|yes)$/i.test(clean)) {
    return { action: 'approve' }
  }

  // 关键字 + 节点ID: "通过 node-xxx"
  const bareApproveMatch = clean.match(/^(通过|approve|批准)\s+(\S+)$/i)
  if (bareApproveMatch) {
    return { action: 'approve', nodeId: bareApproveMatch[2] }
  }

  // 裸拒绝关键字
  if (/^(拒绝|reject|no|否)$/i.test(clean)) {
    return { action: 'reject' }
  }

  // 拒绝 + 原因: "拒绝 代码有问题"
  const bareRejectMatch = clean.match(/^(拒绝|reject)\s+(.+)$/i)
  if (bareRejectMatch) {
    return { action: 'reject', reason: bareRejectMatch[2] }
  }

  return null
}

/**
 * 处理审批操作
 *
 * @param approval 解析后的审批指令
 * @param onResult 可选回调，用于平台侧发送审批结果通知
 */
export async function handleApproval(
  approval: ParsedApproval,
  onResult?: (result: ApprovalResult) => Promise<void>,
): Promise<string> {
  const waitingJobs = getWaitingHumanJobs()

  if (waitingJobs.length === 0) {
    return '没有待审批的节点'
  }

  let targetJob = waitingJobs[0]
  if (approval.nodeId) {
    const found = waitingJobs.find(j =>
      j.data.nodeId === approval.nodeId ||
      j.data.nodeId.startsWith(approval.nodeId!)
    )
    if (!found) {
      return `未找到节点: ${approval.nodeId}\n当前等待审批的节点: ${waitingJobs.map(j => j.data.nodeId).join(', ')}`
    }
    targetJob = found
  }

  if (!targetJob) {
    return '没有待审批的节点'
  }

  const { instanceId, nodeId, workflowId } = targetJob.data

  try {
    if (approval.action === 'approve') {
      resumeWaitingJob(targetJob.id)
      await markNodeDone(instanceId, nodeId, { approved: true })

      const workflow = getWorkflow(workflowId)
      if (workflow) {
        await handleNodeResult(workflowId, instanceId, nodeId, {
          success: true,
          output: { approved: true },
        })
      }

      if (onResult) {
        await onResult({ nodeId, nodeName: nodeId, approved: true })
      }

      return `✅ 已批准节点: ${nodeId}`
    } else {
      const reason = approval.reason || '用户拒绝'
      markJobFailed(targetJob.id, reason)
      await stateMarkNodeFailed(instanceId, nodeId, reason)

      if (onResult) {
        await onResult({ nodeId, nodeName: nodeId, approved: false, reason })
      }

      return `❌ 已拒绝节点: ${nodeId}\n原因: ${reason}`
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to handle approval: ${errorMessage}`)
    return `处理失败: ${errorMessage}`
  }
}
