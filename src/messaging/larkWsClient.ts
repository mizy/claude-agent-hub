/**
 * 飞书 WebSocket 长连接客户端 — 连接管理层
 *
 * 只负责 WS 生命周期（connect/stop/status），事件处理委托给 larkEventRouter。
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../shared/logger.js'
import { formatErrorMessage } from '../shared/formatErrorMessage.js'
import { getLarkConfig } from '../config/index.js'
import { DATA_DIR } from '../store/paths.js'
import {
  markDaemonStarted as markStarted,
  createLarkAdapter,
  processMessageEvent,
  handleCardAction,
  handleP2pChatCreate,
} from './larkEventRouter.js'
import type { LarkMessageEvent, LarkCardActionEvent, LarkP2pChatCreateEvent } from './larkEventRouter.js'

const logger = createLogger('lark-ws')

let wsClient: Lark.WSClient | null = null
let larkClient: Lark.Client | null = null
let larkBotName: string | null = null
let defaultLarkChatId: string | null = null

// Persist default chatId so subprocesses can read it for push notifications
const LARK_CHAT_ID_FILE = join(DATA_DIR, 'lark-chat-id')

function persistChatId(chatId: string): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(LARK_CHAT_ID_FILE, chatId, 'utf-8')
  } catch {
    logger.debug('Failed to persist lark chatId')
  }
}

function loadPersistedChatId(): string | null {
  try {
    return readFileSync(LARK_CHAT_ID_FILE, 'utf-8').trim() || null
  } catch (error) {
    logger.debug(`Failed to load persisted chatId: ${formatErrorMessage(error)}`)
    return null
  }
}

function onChatIdDiscovered(chatId: string): void {
  if (!defaultLarkChatId) {
    defaultLarkChatId = chatId
    persistChatId(chatId)
    logger.info(`Default Lark chatId recorded: ${chatId}`)
  }
}

/** Reset startup timestamp. Call when daemon starts/restarts. */
export function markDaemonStarted(): void {
  markStarted()
}

export async function startLarkWsClient(): Promise<void> {
  if (wsClient) {
    logger.warn('Lark WebSocket client already running')
    return
  }

  const larkConfig = await getLarkConfig()
  const { appId, appSecret } = larkConfig || {}

  if (!appId || !appSecret) {
    throw new Error('Missing Lark appId or appSecret in config')
  }

  const baseConfig = { appId, appSecret }
  larkClient = new Lark.Client(baseConfig)

  // Fetch bot name
  try {
    const res = await larkClient.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info/',
    })
    const botInfo = res as { bot?: { app_name?: string }; data?: { bot?: { app_name?: string } } }
    larkBotName = botInfo?.bot?.app_name ?? botInfo?.data?.bot?.app_name ?? null
  } catch (error) {
    logger.warn(`Failed to fetch bot name: ${formatErrorMessage(error)}`)
  }

  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  const adapter = createLarkAdapter(larkClient)
  const client = larkClient

  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: LarkMessageEvent) => {
      await processMessageEvent(data, client, adapter, larkBotName, onChatIdDiscovered)
    },
  })

  // Card button callback
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK lacks type defs for card actions
    dispatcher.register({ 'card.action.trigger': (data: LarkCardActionEvent) => handleCardAction(data, adapter) } as any)
  } catch {
    logger.warn('card.action.trigger registration not supported by SDK, skipping')
  }

  // New chat created (welcome message)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK lacks type defs for this event
    dispatcher.register({ p2p_chat_create: (data: LarkP2pChatCreateEvent) => handleP2pChatCreate(data, adapter, onChatIdDiscovered) } as any)
  } catch {
    logger.warn('p2p_chat_create registration not supported by SDK, skipping')
  }

  // Log-only events (suppress SDK "no handle" warnings)
  const logEvent = (name: string) => async (data: unknown) => {
    logger.info(`← [event] ${name}: ${JSON.stringify(data).slice(0, 120)}`)
  }
  const noop = async () => {}
  try {
    dispatcher.register({
      'im.message.reaction.created_v1': logEvent('reaction.created'),
      'im.message.reaction.deleted_v1': logEvent('reaction.deleted'),
      'im.message.recalled_v1': logEvent('message.recalled'),
      'im.chat.member.user.added_v1': logEvent('chat.member.added'),
      'im.message.bot_muted_v1': logEvent('bot.muted'),
      'im.chat.access_event.bot_p2p_chat_entered_v1': noop,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK lacks type defs for these events
    } as any)
  } catch {
    logger.debug('Some log-only event registrations not supported, skipping')
  }

  wsClient.start({ eventDispatcher: dispatcher })

  logger.info(`Lark WebSocket client started${larkBotName ? ` as "${larkBotName}"` : ''}`)
}

export async function stopLarkWsClient(): Promise<void> {
  if (!wsClient) return
  wsClient.close()
  wsClient = null
  larkClient = null
  larkBotName = null
  defaultLarkChatId = null
  logger.info('Lark WebSocket client stopped')
}

export function getLarkClient(): Lark.Client | null {
  return larkClient
}

export function isLarkWsClientRunning(): boolean {
  return wsClient !== null
}

export function getDefaultLarkChatId(): string | null {
  if (defaultLarkChatId) return defaultLarkChatId
  return loadPersistedChatId()
}
