/**
 * @entry Notify 通知模块
 *
 * 提供消息通知能力，支持飞书
 *
 * 主要 API:
 * - sendLarkMessage(): 发送飞书消息
 * - sendReviewNotification(): 发送审批通知
 * - startLarkServer(): 启动飞书服务
 */

export {
  sendReviewNotification,
  sendLarkMessage,
  sendApprovalResultNotification,
} from './sendLarkNotify.js'

export {
  startLarkServer,
  stopLarkServer,
  isLarkServerRunning,
} from './larkServer.js'
