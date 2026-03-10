# Claude Agent Hub

自举式 AI 任务系统 — 用自己来开发自己。

## 核心命令

```bash
# 任务（必须在目标项目目录下运行，cwd 用于同项目冲突检测和自动串行）
cah "任务描述"           # 创建并执行（-p priority, -a agent, -b backend, -m model, -S schedule, -F 前台, --no-run 仅创建, -v verbose, -d data-dir）
cah list                 # 任务列表（-s status, -w watch, --no-progress, -a agent, --source, --cwd, --project, -i interval）
cah logs <id>            # 任务日志（-f follow, -n tail）
cah run                  # 手动执行队列中下一个 pending 任务
cah chat <message>       # 与 AI 对话（一次性）
cah task add|list|show|stats|logs|delete|stop|clear|complete|reject|resume|pause|snapshot|msg|inject-node|trace  # 详见 cah task --help

# 守护进程
cah start [-D]           # 启动（-D 后台），cah stop, cah restart, cah status

# 其他子命令（详见 cah <cmd> --help）
cah report work|trend|live    # 报告
cah memory list|add|search|delete|health|fading|reinforce|associations|episodes|recall|link|cleanup  # 记忆
cah self check [--fix|--auto-fix]|status  # 自检查
cah self evolve analyze|validate|history  # 自进化
cah self drive start|stop|disable|enable|status|goals  # 自驱管理
cah schedule create|list|stop  # 定时任务
cah backend list|current      # 后端
cah prompt versions|rollback|diff|compare|test|evaluate|extract  # Prompt 管理
cah agent list|show           # Agent 管理
cah stats overview|chat|task|growth  # 统计（--json）
cah init                 # 初始化
cah dashboard start|stop|status  # 可视化面板
```

## 分层架构

```
CLI (cli/) → Server/Report/Messaging  表现层
Task (task/) → Scheduler/Workflow/Analysis/Output/SelfEvolve/SelfDrive  业务层
Backend (backend/)  集成层（claude-code/opencode/iflow/codebuddy/cursor）
Memory/Agents/Prompts/PromptOptimization/Config/Consciousness/Statistics  领域层
Store (store/)  持久层（GenericFileStore）
Shared (shared/) / Types (types/)  基础设施
```

## 任务执行流程

```
cah "描述" → createTask(cwd, pending)
  → prepareNewExecution(planning) → [generateTaskTitle] → generateWorkflow(analyzeProject + learnHistory + retrieveMemory) → invokeBackend
  → startWorkflow → updateTask(developing) → NodeWorker 并发执行节点 → invokeBackend
  → saveWorkflowOutput → emitWorkflowCompleted → updateTask(completed/failed)
```

特殊路径：isDirectAnswer 跳过节点执行 | schedule-wait 进入 waiting，daemon waitingRecoveryJob 到期恢复 | resume 有 failed 重试，全 pending 重启

## 数据结构

数据目录：`~/.cah-data/`（`CAH_DATA_DIR` 可覆盖）

```
.cah-data/
├── tasks/{uuid}/        # task.json, workflow.json, instance.json, process.json, stats.json, timeline.json, messages.json
│   ├── logs/            # execution.log, conversation.log, events.jsonl, conversation.jsonl
│   ├── outputs/         # result.md
│   └── traces/          # trace-{traceId}.jsonl (OTLP Span)
├── memory/ episodes/    # 语义/情景记忆
├── logs/prompts/        # 每次 backend 调用的完整 prompt
├── prompt-versions/     # Prompt 版本管理
├── sessions.json        # 会话管理
├── chat-buffers.json    # IM 聊天缓冲
├── chat-sessions/       # 聊天会话数据
├── selfdrive/           # 自驱动数据
├── evolution/           # 自进化数据
├── failure-kb/          # 失败知识库
├── success-patterns/    # 成功模式
├── conversation.jsonl   # 全局 IM 对话日志（in/out/event/cmd）
├── queue.json           # 任务队列
├── runner.lock          # 队列运行锁
├── daemon.pid           # daemon PID
└── tmp/                 # 临时文件
```

## 配置

**唯一配置文件：`~/.claude-agent-hub.yaml`**（全局，不使用 config.json 或其他格式）

- 环境变量可覆盖部分字段：`CAH_LARK_APP_ID`、`CAH_BACKEND_TYPE` 等
- 加载逻辑：`config/loadConfig.ts`，schema + 默认值：`config/schema.ts`
- 支持 file watch 热加载（500ms debounce），修改即生效
- Backend 配置只需写 `type` 和 `model`，其余字段走 schema 默认值

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

## 定时任务

所有定时任务通过 workflow 实现：`cah "描述" -S "<cron>"` → `[schedule-wait] → [task] → [lark-notify]`。任务描述写具体指令，不含 slash command。

## 规范

- 文件/函数: 动词+名词，类: PascalCase，`@entry` 标记入口
- 单文件 ≤ 500 行，代码注释英文，CLI 输出中文
- rebuild 后由用户手动 `cah restart` 或 `/reload` 重启 daemon（**任务/Agent 内部严禁执行 `cah restart`/`cah stop`/`kill`，否则会终止正在运行的 daemon**；stale_daemon 检测机制会在安全时机自动重启）
