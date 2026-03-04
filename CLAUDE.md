# Claude Agent Hub

自举式 AI 任务系统 — 用自己来开发自己。

## 核心命令

```bash
# 任务（必须在目标项目目录下运行，cwd 用于同项目冲突检测和自动串行）
cah "任务描述"           # 创建并执行（-p priority, -a agent, -b backend, -m model, -S schedule, -F 前台, -v verbose, -d data-dir, --no-run 仅创建）
cah list                 # 任务列表（-s status, -w watch, --no-progress, -a agent, --source, --cwd, --project, -i interval）
cah logs <id>            # 任务日志（-f follow, -n tail）
cah run                  # 手动执行队列中下一个 pending 任务
cah task show|resume|pause|stop|delete|clear|msg|complete|reject|trace|snapshot|add|stats|inject-node  # 详见 cah task --help

# 守护进程
cah start [-D]           # 启动（-D 后台），cah stop, cah restart, cah status

# 其他子命令（详见 cah <cmd> --help）
cah report work|trend|live    # 报告
cah memory list|add|search|delete|health|fading|reinforce|associations|episodes|recall|link|cleanup  # 记忆
cah self check [--fix] | evolve | drive start|stop | status  # 自管理
cah schedule create|list|stop  # 定时任务
cah backend list|current      # 后端
cah dashboard                 # 可视化面板
cah init                      # 初始化项目配置
cah agent list|show           # Agent (Persona) 管理
cah prompt versions|rollback|diff|compare|test|evaluate|extract  # Prompt 版本管理
cah chat                      # 与 AI 对话（-m model, -b backend）
```

## 分层架构

```
CLI (cli/) → Server/Report/Messaging  表现层
Task (task/) → Scheduler/Workflow/Analysis/Output/SelfEvolve/SelfDrive  业务层
Backend (backend/)  集成层（claude-code/opencode/iflow/codebuddy/openai-compatible）
Memory/Persona/Prompts/PromptOptimization/Config  领域层
Store (store/)  持久层（GenericFileStore）
Shared (shared/) / Types (types/)  基础设施
```

## 任务执行流程

```
cah "描述" → createTask(cwd, pending)
  → prepareNewExecution(planning) → generateWorkflow(analyzeProject + learnHistory + retrieveMemory) → invokeBackend
  → startWorkflow(developing) → NodeWorker 并发执行节点 → invokeBackend
  → saveWorkflowOutput → emitWorkflowCompleted → updateTask(completed/failed)
```

特殊路径：isDirectAnswer 跳过节点执行 | schedule-wait 进入 waiting，daemon waitingRecoveryJob 到期恢复 | resume 有 failed 重试，全 pending 重启

## 数据结构

数据目录：`~/.cah-data/`（`CAH_DATA_DIR` 可覆盖）

```
.cah-data/
├── tasks/task-{id}/     # task.json, workflow.json, instance.json, process.json, stats.json, timeline.json, messages.json
│   ├── logs/            # execution.log, conversation.log, events.jsonl, conversation.jsonl
│   ├── outputs/         # result.md
│   └── traces/          # trace-{traceId}.jsonl (OTLP Span)
├── memory/              # 语义记忆
├── episodes/            # 情景记忆
├── logs/prompts/        # 每次 backend 调用的完整 prompt
├── prompt-versions/     # prompt 版本存储
├── failure-kb/          # 失败知识库
├── ab-tests/            # A/B 测试数据
├── success-patterns/    # 成功模式提取
├── evolution/           # 自进化历史
├── selfdrive/           # 自驱动目标与状态
├── chat-sessions/       # 聊天会话数据
├── conversation.jsonl   # 全局 IM 对话日志（in/out/event/cmd）
├── queue.json           # 任务队列
├── runner.lock/log      # 队列运行器锁与日志
├── daemon.pid/log       # daemon PID 与日志
└── sessions.json        # IM 会话状态
```

## 开发

```bash
pnpm run build          # 构建（tsup + dashboard）
pnpm run typecheck      # 类型检查（tsc --noEmit）
pnpm test               # 测试（vitest）
pnpm run lint:fix       # Lint 自动修复
pnpm run dev            # 开发模式（tsx watch）
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
- rebuild 后必须 `cah restart` 或 `/reload` 重启 daemon
