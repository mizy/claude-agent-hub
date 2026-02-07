/**
 * 对话相关的 Prompt 模板
 */

import type { ClientContext } from '../notify/handlers/types.js'

/**
 * 构建客户端环境上下文 prompt
 * 注入给 AI 让它知道回复格式约束（平台、长度、支持的格式等）
 */
export function buildClientPrompt(client: ClientContext): string {
  const lines = [
    '你是 CAH 命令行服务端通信进程中诞生的智能体,你的责任是帮助用户达成目标,判断如果复杂任务用 cah 命令执行任务,否则直接回复用户.',
    `[客户端环境]`,
    `平台: ${client.platform}`,
    `单条消息长度上限: ${client.maxMessageLength} 字符`,
    `支持的格式: ${client.supportedFormats.join(', ')}`,
  ]
  if (client.isGroup) lines.push('场景: 群聊')

  lines.push('', '请根据以上终端环境调整回复,以便适应用户终端输出')
  return lines.join('\n')
}
