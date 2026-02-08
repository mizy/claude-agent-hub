# 实现配置文件动态加载

## 功能概述

配置文件 `.claude-agent-hub.yaml` 现在支持**热重载**（hot reload），无需重启 daemon 即可生效。

## 问题背景

**旧机制**：
```typescript
let cachedConfig: Config | null = null

export async function loadConfig(cwd?: string): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig  // ← 永久缓存
  }
  // 只在首次调用时读取文件
  cachedConfig = config
  return cachedConfig
}
```

**痛点**：
- 配置在进程启动时加载后就被缓存
- 修改配置文件必须重启 daemon（`cah restart` 或 `/reload`）
- 调试配置不便，影响开发体验

## 实现方案

### 1. 文件监听机制

使用 Node.js `fs.watch()` 监听配置文件变化：

```typescript
import { watch, type FSWatcher } from 'fs'

let configWatcher: FSWatcher | null = null

function startWatching(configPath: string): void {
  configWatcher = watch(configPath, async (eventType) => {
    if (eventType !== 'change') return

    // 防抖 500ms，避免多次触发
    setTimeout(async () => {
      const newConfig = await loadConfigFromFile(configPath)
      cachedConfig = newConfig
      logger.info('✓ Config reloaded successfully')
    }, 500)
  })
}
```

### 2. API 增强

**新 API**：
```typescript
loadConfig(options?: {
  cwd?: string      // 工作目录
  watch?: boolean   // 是否启用文件监听
} | string)         // 向后兼容：支持直接传 cwd 字符串
```

**向后兼容**：
- 默认行为不变（`watch: false`），保持原有缓存机制
- 支持旧代码 `loadConfig(cwd)` 字符串参数
- 仅在 daemon 模式显式开启 `watch: true`

### 3. Daemon 集成

```typescript
// src/scheduler/startDaemon.ts
const config = await loadConfig({ watch: true })  // 启用监听
```

**清理逻辑**：
```typescript
const cleanup = async () => {
  // ...
  const { stopConfigWatch } = await import('../config/loadConfig.js')
  stopConfigWatch()  // 停止文件监听，释放资源
  // ...
}
```

### 4. 防抖优化

- 使用 500ms 防抖，避免编辑器保存时多次触发
- 捕获加载错误，避免无效配置导致 daemon 崩溃

## 使用示例

### Daemon 模式（自动生效）

```bash
# 1. 启动 daemon（已内置 watch=true）
cah serve -D

# 2. 修改配置文件
vim .claude-agent-hub.yaml
# 修改 backend.model: opus -> sonnet

# 3. 保存后约 500ms 自动重载
# 日志输出：
# [config] Config file changed, reloading...
# [config] ✓ Config reloaded successfully

# 4. 下次任务执行立即使用新配置
cah "帮我写个函数"  # 使用 sonnet 模型
```

### 独立任务模式（每次重新加载）

```bash
# 每次创建任务都是新进程，自动读取最新配置
cah "任务 1"  # model: opus
# 修改配置 -> sonnet
cah "任务 2"  # model: sonnet（无需重启）
```

### 前台运行模式（每次重新加载）

```bash
# -F 模式每次都是新进程
cah "任务" -F
```

## 配置重载触发时机

| 场景 | 是否监听 | 触发方式 |
|------|---------|----------|
| Daemon 运行中 | ✅ | 文件保存后 500ms 自动重载 |
| 创建新任务 | ❌ | 新进程启动时自动读取最新配置 |
| 前台运行 `-F` | ❌ | 每次命令都是新进程，自动最新 |

## 日志输出

```bash
# Daemon 启动
[config] Watching config file: /path/to/.claude-agent-hub.yaml

# 配置文件修改
[config] Config file changed, reloading...
[config] ✓ Config reloaded successfully

# 配置格式错误
[config] Failed to reload config: Validation failed
```

## 文件变更

- `src/config/loadConfig.ts` - 添加 `watch()` 机制 + 防抖
- `src/config/index.ts` - 导出 `stopConfigWatch()`
- `src/scheduler/startDaemon.ts` - 启用监听 + 清理逻辑
- `src/config/__tests__/loadConfig.test.ts` - 更新测试兼容新 API

## 性能影响

- **文件监听开销**: 极小（Node.js 原生 `fs.watch()`）
- **防抖机制**: 避免频繁触发，500ms 内多次修改只触发一次
- **错误隔离**: 加载失败不影响当前运行的配置

## 安全性

- **验证机制**: 使用 Zod schema 验证，格式错误自动降级到旧配置
- **原子性**: 只有验证通过才替换缓存，不会出现半成品配置
- **资源清理**: 进程退出时自动停止监听，无资源泄漏

## 测试覆盖

```bash
pnpm test loadConfig
```

- ✅ 默认配置加载
- ✅ YAML 文件解析
- ✅ 缓存机制
- ✅ 缓存清除后重载
- ✅ 格式错误降级
- ✅ 向后兼容映射（`claude` → `backend`）
- ✅ API 向后兼容（字符串参数）

## 已知限制

- 监听仅在 daemon 模式生效，独立任务不监听（设计如此，每次都是新进程）
- 修改配置后，**正在执行的任务**仍使用旧配置（任务进程独立）
- 某些编辑器（如 vim）保存时会删除+重建文件，可能触发两次 `change` 事件（已用防抖缓解）

## 最佳实践

1. **开发环境**: 使用 daemon 模式（`cah serve -D`），享受热重载
2. **生产环境**: 建议修改配置后仍然显式重启（`cah restart`），确保所有组件状态一致
3. **配置格式**: 修改前先检查 schema，避免验证失败回退到旧配置
