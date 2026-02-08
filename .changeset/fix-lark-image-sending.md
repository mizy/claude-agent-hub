# 修复 Lark 发送 Puppeteer 截图失败问题

## 问题描述

Claude Code 通过 Puppeteer MCP 截图成功后，CAH 无法将图片发送到 Lark 机器人。

## 根因分析

`extractImagePaths()` 函数的正则表达式**仅匹配绝对路径**（以 `/` 开头），导致以下场景失败：

1. **相对路径**：`screenshot.png` 或 `./screenshot.png`
2. **Markdown 图片语法**：`![Screenshot](screenshot-1234.png)`
3. **代码块中的路径**：包裹在反引号中的路径

Puppeteer 截图后，Claude Code 在响应中可能返回：
```
Screenshot saved to screenshot-20260208.png
```

但旧正则仅匹配：
```typescript
/(?:^|\s)(\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))/
//         ^^^ 必须以 / 开头
```

导致相对路径无法被提取，图片发送失败。

## 修复方案

### 1. 增强路径提取逻辑 (src/notify/handlers/chatHandler.ts)

支持三种模式：

**Pattern 1: 绝对路径**
```typescript
/(?:^|\s|["'`])(\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$|["'`)\]},;:])/gim
```

**Pattern 2: Markdown 图片语法**
```typescript
/!\[.*?\]\(([\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))\)/gi
```

**Pattern 3: 相对路径**
```typescript
/(?:^|\s|["'`])(\.?\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp)|[\w-]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$|["'`)\]},;:])/gim
```

### 2. 智能路径解析 (resolveImagePath)

对于相对路径，按优先级尝试解析：
1. **cwd**: `process.cwd() + relativePath`
2. **系统临时目录**: `/tmp`, `/var/tmp`, `$TMPDIR`

### 3. 增强日志输出

发送图片时打印详细信息：
- 检测到的图片数量
- 读取的文件路径和大小
- 上传飞书的进度（上传中 → 获取 image_key → 发送消息）
- 失败时打印完整错误堆栈

**Before**:
```
[lark-notify] Failed to send image screenshot.png: ENOENT
```

**After**:
```
[chat-handler] Detected 1 image(s) in response
[chat-handler] Reading image: /tmp/screenshot-12345.png
[chat-handler] Sending image (45678 bytes) to oc_abc123
[lark-notify] Uploading image to Lark (45678 bytes)
[lark-notify] ✓ Uploaded image to Lark: img_v2_abc123
[lark-notify] Sending image to Lark chat oc_abc123 (key: img_v2_abc123)
[lark-notify] ✓ Image sent to Lark chat oc_abc123
[chat-handler] ✓ Image sent: /tmp/screenshot-12345.png
```

### 4. 添加单元测试

新增 `imagePathExtraction.test.ts`，覆盖所有场景：
- ✅ 绝对路径提取
- ✅ Markdown 语法提取
- ✅ 相对路径从 /tmp 解析
- ✅ 反引号包裹路径提取
- ✅ 路径去重
- ✅ 忽略不存在的文件

## 文件变更

- `src/notify/handlers/chatHandler.ts` - 重写 `extractImagePaths` + 新增 `resolveImagePath`
- `src/notify/sendLarkNotify.ts` - 增强日志输出
- `src/notify/handlers/__tests__/imagePathExtraction.test.ts` - 新增测试

## 使用建议

### 测试场景

在飞书中发送：
```
帮我截图 https://example.com 的首页
```

预期行为：
1. Claude Code 调用 Puppeteer MCP 截图
2. 返回响应含路径（如 `Screenshot saved to /tmp/screenshot-abc.png`）
3. CAH 提取路径并读取文件
4. 上传到飞书并发送图片消息

### 调试

查看 daemon 日志确认图片处理流程：
```bash
tail -f ~/.cah-data/daemon.log | grep -E "image|screenshot"
```

## 兼容性

- **向后兼容**：绝对路径仍然正常工作
- **新增支持**：相对路径、Markdown 语法、多种引号包裹
- **安全性**：仅发送 `existsSync()` 验证存在的文件，防止路径注入

## 已知限制

- 仅支持本地文件路径，不支持 HTTP URL
- 路径必须以图片扩展名结尾（`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`）
- 相对路径解析依赖 cwd 或临时目录，跨系统可能需要调整
