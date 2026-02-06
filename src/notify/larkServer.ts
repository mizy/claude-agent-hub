/**
 * 飞书事件监听服务（WSClient 模式）
 * 通过 WebSocket 长连接接收 @机器人 消息，处理审批指令
 * 无需公网 IP
 */

import { startLarkWsClient, stopLarkWsClient, isLarkWsClientRunning } from './larkWsClient.js'
import { createLogger } from '../shared/logger.js'

const logger = createLogger('lark-server')

/**
 * 启动飞书事件监听（WSClient 长连接）
 * @param _port 已废弃，WSClient 模式不需要端口
 */
export async function startLarkServer(_port?: number): Promise<void> {
  if (_port) {
    logger.warn('port parameter is deprecated, WSClient mode does not use a port')
  }
  await startLarkWsClient()
}

/**
 * 停止飞书事件监听
 */
export async function stopLarkServer(): Promise<void> {
  await stopLarkWsClient()
}

/**
 * 检查服务是否运行中
 */
export function isLarkServerRunning(): boolean {
  return isLarkWsClientRunning()
}
