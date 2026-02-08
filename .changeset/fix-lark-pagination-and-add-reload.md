# 修复飞书卡片交互 + 新增守护进程热重载

## 问题描述

飞书卡片所有按钮点击都无响应，包括：
- 任务列表分页（下一页/上一页）
- 任务详情/日志/重试按钮
- 审批通过/拒绝按钮

## 根因分析

飞书 SDK `@larksuiteoapi/node-sdk@1.58.0` 的 v2 事件解析后，`open_chat_id` 和 `open_message_id` **嵌套在 `context` 字段下**，而不是顶层。

代码直接读 `data?.open_chat_id` 得到 `undefined`，导致 `handleCardAction` 入口处提前返回：

```typescript
// 旧代码 - 永远得到 undefined
const chatId = data?.open_chat_id
if (!chatId || !value) return  // 直接退出
```

SDK 实际数据结构（v2 event）：
```json
{
  "context": {
    "open_chat_id": "oc_xxx",
    "open_message_id": "om_xxx"
  },
  "action": { "value": { ... } }
}
```

## 修复方案

### 1. 飞书卡片交互修复 (src/notify/larkWsClient.ts)

- 新增 `LarkCardActionEvent.context` 接口字段
- `handleCardAction` 同时读取 `data.open_chat_id` 和 `data.context.open_chat_id`（向后兼容）
- 分页操作优化：通过 SDK 回调返回卡片实现原地更新 + API `editCard` 作为 fallback

### 2. 守护进程热重载 (新增功能)

**CLI 命令**:
```bash
cah restart              # 重启守护进程（后台模式，默认）
cah restart --no-detach  # 前台模式重启
```

**飞书/Telegram 命令**:
```
/reload                  # 在 IM 中重启守护进程，加载新代码
```

**实现原理**:
- `restartDaemon`: 原子化执行 stop + 延迟 1s + start
- `/reload` 指令通过 `spawn` 子进程调用 `cah restart`，避免阻塞消息回复
- 守护进程重启期间（~2s），正在运行的任务不受影响（进程隔离）

### 3. 帮助文档更新

- `/help` 和飞书卡片新增 `🔧 系统` 分类
- 添加 `/reload` 指令说明

## 文件变更

- `src/notify/larkWsClient.ts` - 修复 chatId/messageId 读取路径
- `src/notify/buildLarkCard.ts` - 更新 help card
- `src/notify/handlers/commandHandler.ts` - 新增 `/reload` 处理 + help 更新
- `src/scheduler/restartDaemon.ts` - 新增重启逻辑
- `src/scheduler/index.ts` - 导出 `restartDaemon`
- `src/cli/commands/daemon.ts` - 注册 `restart` 命令

## 使用建议

1. **开发流程优化**: rebuild 后通过飞书发送 `/reload` 即可加载新代码，无需手动 SSH
2. **生产环境**: `cah restart` 实现零停机更新（任务不中断）
3. **调试**: `/reload` 会输出重启提示，2s 后用 `/status` 确认状态

## 注意事项

- 守护进程重启会断开飞书 WebSocket，~1s 后自动重连
- 重启期间收到的消息会在重连后处理（飞书服务端队列）
- 必须 rebuild 后才能生效新代码（`pnpm run build`）
