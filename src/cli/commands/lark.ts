/**
 * @entry cah lark 命令组 — 飞书消息发送
 *
 * 子命令：
 *   cah lark send <message>     发送文本消息
 *   cah lark card <markdown>    发送 markdown 卡片
 */

import { Command } from 'commander'
import * as LarkSdk from '@larksuiteoapi/node-sdk'
import { success, error } from '../output.js'
import { getLarkConfig } from '../../config/index.js'
import { getLarkClient, getDefaultLarkChatId } from '../../messaging/larkWsClient.js'
import { buildCard, mdElement } from '../../messaging/buildLarkCard.js'
import { markdownToPostContent } from '../../messaging/larkCardWrapper.js'
import { withLarkRetry } from '../../messaging/larkRetry.js'
import { getErrorMessage } from '../../shared/assertError.js'

async function getClient(): Promise<LarkSdk.Client | null> {
  const shared = getLarkClient()
  if (shared) return shared

  const larkConfig = await getLarkConfig()
  const { appId, appSecret } = larkConfig || {}
  if (!appId || !appSecret) return null

  return new LarkSdk.Client({ appId, appSecret })
}

function resolveChatId(chatOpt?: string, userOpt?: string): { receiveId: string; receiveIdType: 'chat_id' | 'open_id' } | null {
  if (userOpt) return { receiveId: userOpt, receiveIdType: 'open_id' }
  if (chatOpt) return { receiveId: chatOpt, receiveIdType: 'chat_id' }
  const defaultChat = getDefaultLarkChatId()
  if (defaultChat) return { receiveId: defaultChat, receiveIdType: 'chat_id' }
  return null
}

export function registerLarkCommand(program: Command) {
  const lark = program
    .command('lark')
    .description('飞书消息发送')

  // cah lark send <message>
  lark
    .command('send')
    .description('发送文本消息到飞书')
    .argument('[message]', '消息内容（传 - 则从 stdin 读取）')
    .option('-c, --chat <chatId>', '指定 chat_id')
    .option('-u, --user <userId>', '指定 user_id (open_id)')
    .action(async (message: string | undefined, options: { chat?: string; user?: string }) => {
      const client = await getClient()
      if (!client) {
        error('飞书凭证未配置，请在 ~/.claude-agent-hub.yaml 中配置 notify.lark.appId 和 appSecret')
        process.exitCode = 1
        return
      }

      const target = resolveChatId(options.chat, options.user)
      if (!target) {
        error('未指定接收方，请使用 --chat 或 --user，或确保配置了默认 chatId')
        process.exitCode = 1
        return
      }

      let text = message
      if (!text || text === '-') {
        if (process.stdin.isTTY) {
          error('未提供消息内容，请传入参数或通过 stdin 输入（如 echo "内容" | cah lark send -）')
          process.exitCode = 1
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer)
        }
        text = Buffer.concat(chunks).toString('utf-8').trim()
        if (!text) {
          error('stdin 无内容')
          process.exitCode = 1
          return
        }
      }

      try {
        const content = markdownToPostContent(text)
        await withLarkRetry(
          () => client.im.v1.message.create({
            params: { receive_id_type: target.receiveIdType },
            data: {
              receive_id: target.receiveId,
              content,
              msg_type: 'post',
            },
          }),
          'cliLarkSend'
        )
        success(`消息已发送 (${target.receiveIdType}: ${target.receiveId.slice(0, 12)}...)`)
      } catch (e) {
        error(`发送失败: ${getErrorMessage(e)}`)
        process.exitCode = 1
      }
    })

  // cah lark card <markdown>
  lark
    .command('card')
    .description('发送 markdown 卡片到飞书')
    .argument('[markdown]', 'markdown 内容（传 - 则从 stdin 读取）')
    .option('-c, --chat <chatId>', '指定 chat_id')
    .option('-u, --user <userId>', '指定 user_id (open_id)')
    .option('-t, --title <title>', '卡片标题')
    .action(async (markdown: string | undefined, options: { chat?: string; user?: string; title?: string }) => {
      const client = await getClient()
      if (!client) {
        error('飞书凭证未配置，请在 ~/.claude-agent-hub.yaml 中配置 notify.lark.appId 和 appSecret')
        process.exitCode = 1
        return
      }

      const target = resolveChatId(options.chat, options.user)
      if (!target) {
        error('未指定接收方，请使用 --chat 或 --user，或确保配置了默认 chatId')
        process.exitCode = 1
        return
      }

      let content = markdown
      if (!content || content === '-') {
        if (process.stdin.isTTY) {
          error('未提供 markdown 内容，请传入参数或通过 stdin 输入（如 echo "内容" | cah lark card -）')
          process.exitCode = 1
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer)
        }
        content = Buffer.concat(chunks).toString('utf-8').trim()
        if (!content) {
          error('stdin 无内容')
          process.exitCode = 1
          return
        }
      }

      try {
        const card = buildCard(options.title || '', 'blue', [mdElement(content)])
        await withLarkRetry(
          () => client.im.v1.message.create({
            params: { receive_id_type: target.receiveIdType },
            data: {
              receive_id: target.receiveId,
              content: JSON.stringify(card),
              msg_type: 'interactive',
            },
          }),
          'cliLarkCard'
        )
        success(`卡片已发送 (${target.receiveIdType}: ${target.receiveId.slice(0, 12)}...)`)
      } catch (e) {
        error(`发送失败: ${getErrorMessage(e)}`)
        process.exitCode = 1
      }
    })
}
