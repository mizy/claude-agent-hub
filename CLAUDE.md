# Claude Agent Hub

自举式 AI 任务系统 — 终极目标是成为数字生命。

## 分层架构

```
CLI (cli/) → Server/Report/Messaging  表现层
Task (task/) → Scheduler/Workflow/Analysis/Output/SelfEvolve/SelfDrive  业务层
Backend (backend/)  集成层（claude-code/opencode/iflow/codebuddy/cursor）
Memory/Agents/Prompts/PromptOptimization/Config/Consciousness/Statistics/Notification/Runtime  领域层
Store (store/)  持久层（GenericFileStore）
Shared (shared/) / Types (types/)  基础设施
```

## 配置

**唯一配置文件：`~/.claude-agent-hub.yaml`**（全局，不使用 config.json 或其他格式）

- 加载逻辑：`config/loadConfig.ts`，schema + 默认值：`config/schema.ts`
- 支持 file watch 热加载（500ms debounce），修改即生效

## 开发

```bash
pnpm run build          # 构建（tsup + dashboard）
pnpm run build:types    # 仅生成类型声明
pnpm run typecheck      # 类型检查（tsc --noEmit）
pnpm test               # 测试（vitest run）
pnpm run test:watch     # 测试 watch 模式
pnpm run lint:fix       # Lint 自动修复
pnpm run dev            # 开发模式（tsx watch）
pnpm run build:binary   # SEA 单文件构建
pnpm run clean          # 清理 dist
```

## 架构模式

- **事件驱动解耦**：`taskEventBus`（shared/events/taskEvents.ts）打断 task ↔ messaging 循环依赖，注册点在 `messaging/registerTaskEventListeners.ts`
- **Backend Registry**：`resolveBackend.ts` 统一注册，`backendConfig.ts` 独立提供 config 避免循环
- **错误处理**：用 `getErrorMessage()` / `ensureError()` 替代 `instanceof Error`；JSON.parse 必须 try-catch

## 规范

- 文件/函数: 动词+名词，类: PascalCase，`@entry` 标记入口
- 单文件 ≤ 500 行，代码注释英文，CLI 输出中文
- 函数< 100 行，参数< 5 个 