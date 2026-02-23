# 功能清单 — 代码实现基准

> 基于代码扫描生成，作为文档同步的比对基准。

## 1. CLI 命令完整清单

### 根命令 `cah`
```
cah [input]              # 创建并执行任务（input 为任务描述）
  -p, --priority <priority>   优先级 (low/medium/high)，默认 medium
  -a, --agent <agent>         指定 Agent
  -b, --backend <type>        指定后端
  -m, --model <model>         指定模型
  -F, --foreground            前台运行
  --no-run                    仅创建不执行
  -v, --verbose               显示 debug 日志
  -d, --data-dir <path>       数据目录（默认 ./.cah-data）
```

### 快捷命令
| 命令 | 等价于 | 说明 |
|------|--------|------|
| `cah list` / `cah ls` | `cah task list` | 任务列表（支持 -s/-a/--source/--no-progress/-w/-i） |
| `cah logs <id>` | `cah task logs <id>` | 任务日志（支持 -f/-n） |
| `cah run` | — | 手动执行队列中下一个 pending 任务 |
| `cah init` | — | 初始化项目配置（支持 -f 强制覆盖） |

### `cah task` — 任务管理
| 子命令 | 参数 | 选项 | 说明 |
|--------|------|------|------|
| `add` | — | -t title, -d desc, -p priority, -a agent, -b backend, -m model | 创建任务 |
| `list` | — | -s status, -a agent, --source, --no-progress, -w, -i interval | 任务列表 |
| `show` / `get` | `<id>` | --json, --verbose | 任务详情 |
| `logs` | `<id>` | -f follow, -n/--tail lines, --head | 查看日志 |
| `stats` | `<id>` | -t timeline, -r report, --markdown, -o output, --json | 执行统计 |
| `delete` / `rm` | `<id>` | — | 删除任务 |
| `stop` / `cancel` | `<id>` | — | 停止任务 |
| `clear` | — | -s status, -a all | 批量清理 |
| `complete` / `done` | `<id>` | — | 完成任务（审核通过） |
| `reject` | `<id>` | -r reason | 驳回任务 |
| `resume` | `[id]` | -a all | 恢复任务 |
| `pause` | `<id>` | -r reason | 暂停任务 |
| `snapshot` | `<id>` | --json | 任务快照 |
| `msg` | `<id> <message>` | — | 向任务发送消息 |
| `inject-node` | `<id> <prompt>` | --persona name | 动态注入节点 |
| `trace` | `<id>` | --slow [ms], --errors, --cost, --export [format] | 执行追踪 |

### `cah agent` — Agent 管理
| 子命令 | 参数 | 说明 |
|--------|------|------|
| `list` | — | 列出可用 Agent |
| `show` | `<name>` | 查看 Agent 详情 |

### `cah start/stop/restart/status` — 守护进程
| 命令 | 选项 | 说明 |
|------|------|------|
| `start` | -D detach | 启动守护进程（默认前台） |
| `stop` | -a agent | 停止守护进程 |
| `restart` | -D detach | 重启守护进程（默认后台） |
| `status` | — | 查看运行状态 |
| `serve`（隐藏） | -D | start 别名 |

### `cah daemon`（隐藏，向后兼容）
子命令：`start`、`stop`、`status`、`logs`（-f/-n/-e）

### `cah report` — 报告
| 子命令 | 选项 | 说明 |
|--------|------|------|
| `work` | -a agent, -d days, -o output | 工作报告 |
| `trend` | -d days, -p period, --markdown, --json, -o output | 趋势分析 |
| `live` / `status` | --json, -w watch, -i interval | 实时监控 |

### `cah memory` — 记忆管理
| 子命令 | 参数 | 选项 | 说明 |
|--------|------|------|------|
| `list` | — | -c category, --project | 记忆列表 |
| `add` | `<content>` | -c category | 添加记忆 |
| `search` | `<query>` | — | 搜索记忆 |
| `delete` / `rm` | `<id>` | — | 删除记忆 |
| `health` | — | — | 健康状态 |
| `fading` | — | — | 即将消退的记忆 |
| `reinforce` | `<id>` | — | 强化记忆 |
| `associations` / `assoc` | `<id>` | — | 查看关联 |
| `episodes` | — | -l limit | 情景记忆列表 |
| `recall` | `<query>` | -l limit | 回忆对话 |
| `link` | `<episodeId> <memoryId>` | — | 关联情景与语义记忆 |
| `cleanup` | — | --dry-run | 遗忘清理 |

### `cah prompt` — 提示词版本管理
| 子命令 | 参数 | 选项 | 说明 |
|--------|------|------|------|
| `versions` | `<persona>` | — | 查看版本列表 |
| `rollback` | `<persona> <version-id>` | — | 回滚版本 |
| `diff` | `<persona> <v1> <v2>` | — | 对比版本 |
| `compare` | `<persona> <v1> <v2>` | — | 对比版本（别名） |
| `test` | `<persona>` | -s min-samples | 启动 A/B 测试 |
| `evaluate` | `<test-id>` | — | 评估测试结果 |
| `extract` | — | -l limit | 提取成功模式 |

### `cah dashboard` — 可视化面板
| 子命令 | 选项 | 说明 |
|--------|------|------|
| `start`（默认） | -p port, -H host, --open, -D detach | 启动面板 |
| `stop` | — | 停止面板 |
| `status` | — | 面板状态 |

### `cah backend` — 后端管理
| 子命令 | 说明 |
|--------|------|
| `list` | 列出可用后端 |
| `current` | 当前后端 |

### `cah selfcheck` — 系统自检
选项：`--fix`、`--auto-fix`、`--repair`

### `cah self` — 自管理
| 子命令 | 选项 | 说明 |
|--------|------|------|
| `check` | --fix, --auto-fix, --repair | 健康检查 |
| `status` | — | 综合状态 |
| `evolve` | — | 运行进化周期 |
| `evolve analyze` | -n limit | 分析失败模式 |
| `evolve validate` | `<id>` | 验证进化效果 |
| `evolve history` | -n limit | 进化历史 |
| `drive start` | — | 启动自驱 |
| `drive stop` | — | 停止自驱 |
| `drive disable` | — | 永久禁用 |
| `drive enable` | — | 重新启用 |
| `drive status` | — | 自驱状态 |
| `drive goals` | — | 自驱目标 |

---

## 2. 分层架构

```
┌─ 表现层 ──────────────────────────────────────────────────────┐
│  cli/          命令行主入口、子命令                              │
│  server/       HTTP 可视化面板（dashboard）                      │
│  report/       报告生成、趋势分析、退化检测                      │
│  messaging/    IM 交互（飞书 WSClient + 卡片 / Telegram）        │
├─ 业务层 ──────────────────────────────────────────────────────┤
│  task/         任务生命周期（创建/执行/暂停/恢复/消息/注入）     │
│  workflow/     AI 工作流引擎（生成/执行/状态/队列/Worker）       │
│  scheduler/    守护进程、事件总线、队列、Worker                  │
│  analysis/     项目上下文分析、历史学习、分类、时间预估          │
│  output/       任务输出保存、标题生成                            │
│  selfcheck/    7 项健康检查、自动修复、修复任务生成              │
│  selfevolve/   失败分析→改进→验证→历史、信号检测                │
│  selfdrive/    目标管理、调度器、daemon 集成、自驱状态           │
├─ 集成层 ──────────────────────────────────────────────────────┤
│  backend/      后端抽象（claude-code/opencode/iflow/codebuddy/openai）│
│  memory/       记忆系统（语义/情景/遗忘/关联/检索）             │
│  persona/      AI 人格定义与加载                                │
│  prompts/      提示词模板                                       │
│  prompt-optimization/  提示词自进化（失败分析/版本/A-B测试）    │
│  config/       YAML 配置加载、Schema 校验                       │
├─ 持久层 ──────────────────────────────────────────────────────┤
│  store/        GenericFileStore + 各专用 Store                  │
├─ 基础设施 ────────────────────────────────────────────────────┤
│  shared/       Result<T,E>、AppError、日志、ID、时间、文本       │
│  types/        共享类型定义                                     │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. @entry 模块入口（26 个）

| 模块 | 入口文件 | 核心能力 |
|------|----------|----------|
| CLI | `cli/index.ts` | 命令行主入口 |
| CLI/Self | `cli/commands/self.ts` | self 命令组 |
| Task | `task/index.ts` | 任务 CRUD + 生命周期 |
| Task/Execute | `task/executeTask.ts` | 任务执行编排 |
| Workflow | `workflow/index.ts` | 工作流公共 API |
| Workflow/Engine | `workflow/engine/WorkflowEngine.ts` | 工作流引擎 |
| Backend | `backend/index.ts` | 后端调用 + 注册 |
| Store | `store/index.ts` | 存储公共 API |
| Store/Message | `store/TaskMessageStore.ts` | 任务消息队列 |
| Memory | `memory/index.ts` | 记忆系统 |
| Shared | `shared/index.ts` | 基础设施 |
| Scheduler | `scheduler/index.ts` | 守护进程 + 队列 |
| Messaging | `messaging/index.ts` | IM 交互 |
| Analysis | `analysis/index.ts` | 项目分析 |
| Report | `report/index.ts` | 报告生成 |
| Persona | `persona/index.ts` | 人格定义 |
| SelfCheck | `selfcheck/index.ts` | 健康检查 |
| SelfEvolve | `selfevolve/index.ts` | 自进化引擎 |
| SelfEvolve/Signal | `selfevolve/signalDetector.ts` | 信号检测 |
| SelfDrive | `selfdrive/index.ts` | 自驱引擎 |
| Config | `config/index.ts` | 配置管理 |
| Types | `types/index.ts` | 类型定义 |
| Prompts | `prompts/index.ts` | 提示词模板 |
| Output | `output/index.ts` | 输出管理 |
| Server | `server/index.ts` | HTTP 面板 |
| PromptOptimization | `prompt-optimization/index.ts` | 提示词优化 |

---

## 4. 可用脚本（package.json）

| 脚本 | 命令 | 说明 |
|------|------|------|
| `build` | `tsup && pnpm run build:dashboard` | 构建（含面板） |
| `build:types` | `tsup --dts-only` | 仅构建类型声明 |
| `build:dashboard` | `cd src/server/dashboard && pnpm run build` | 构建面板 |
| `build:binary` | `bash scripts/build-sea.sh` | 构建独立二进制 |
| `dev` | `tsx watch src/cli/index.ts` | 开发模式 |
| `dev:dashboard` | `cd src/server/dashboard && pnpm run dev` | 面板开发模式 |
| `start` | `node dist/cli/index.js` | 生产运行 |
| `lint` | `eslint src` | Lint 检查 |
| `lint:fix` | `eslint src --fix` | Lint 自动修复 |
| `format` | `prettier --write "src/**/*.ts"` | 格式化 |
| `format:check` | `prettier --check "src/**/*.ts"` | 格式检查 |
| `typecheck` | `tsc --noEmit` | 类型检查 |
| `test` | `vitest run` | 测试 |
| `test:watch` | `vitest` | 测试监控模式 |
| `clean` | `rm -rf dist dist-sea` | 清理构建产物 |
| `prepublishOnly` | `npm run build && npm run build:types` | 发布前构建 |

---

## 5. 数据结构

### 数据目录解析优先级
1. `CAH_DATA_DIR` 环境变量
2. `./.cah-data/`（当前目录下存在时）
3. `~/.cah-data/`（兜底）

### 目录布局
```
.cah-data/
├── tasks/task-{id}/
│   ├── task.json           # 元数据（id, title, status, priority, cwd, source）
│   ├── workflow.json       # 工作流定义（节点、边、变量）
│   ├── instance.json       # 执行状态（节点状态、输出、变量）— 唯一状态源
│   ├── process.json        # 后台进程信息（PID）
│   ├── messages.json       # 任务交互消息队列
│   ├── stats.json          # 聚合统计（从 instance 派生）
│   ├── timeline.json       # 事件时间线
│   ├── logs/
│   │   ├── execution.log       # 主执行日志
│   │   ├── conversation.log    # 对话日志
│   │   ├── events.jsonl        # JSONL 事件流
│   │   └── conversation.jsonl  # JSONL 对话流
│   ├── outputs/
│   │   └── result.md           # 最终输出
│   └── traces/
│       └── trace-{traceId}.jsonl  # OTLP 兼容 Span 数据
├── memory/                 # 语义记忆条目
├── episodes/               # 情景记忆
├── prompt-versions/        # 提示词版本历史
├── queue.json              # 任务队列
├── runner.lock             # 队列 Runner 锁
├── runner.log              # Runner 日志
├── meta.json               # 元数据
└── index.json              # 任务索引
```

---

## 6. 配置项（.claude-agent-hub.yaml）

### 配置文件位置
- 全局：`~/.claude-agent-hub.yaml`
- 项目：`./.claude-agent-hub.yaml`（项目级覆盖全局）

### 完整 Schema
```yaml
agents:                              # Agent 配置列表
  - name: string                     # 必填
    persona: string                  # 默认 Pragmatist
    role: developer|reviewer|both    # 默认 developer
    schedule:
      poll_interval: string          # 默认 5m
      work_hours: string             # 可选

tasks:
  default_priority: low|medium|high  # 默认 medium
  max_retries: number                # 默认 3
  timeout: string                    # 默认 30m

git:
  base_branch: string                # 默认 main
  branch_prefix: string              # 默认 agent/
  auto_push: boolean                 # 默认 false

backend:
  type: claude-code|opencode|iflow|codebuddy|openai  # 默认 claude-code
  model: string                      # 默认 opus
  max_tokens: number                 # 可选
  enableAgentTeams: boolean          # 默认 false（实验性）
  chat:
    mcpServers: string[]             # 默认 []
    session:
      timeoutMinutes: number         # 默认 60
      maxTurns: number               # 默认 10
      maxEstimatedTokens: number     # 默认 50000
      maxSessions: number            # 默认 200
  openaiCompatible:                  # type=openai 时必填
    baseURL: string                  # 必填
    apiKey: string                   # 可选
    defaultModel: string             # 可选
    maxContextLength: number         # 默认 4096
    useClaudeConfig: boolean         # 默认 true
    includeSkills: boolean           # 默认 true

backends:                            # 命名后端映射 (string → BackendConfig)
  custom-name:
    type: ...
    model: ...

defaultBackend: string               # 使用哪个命名后端

notify:
  lark:
    appId: string                    # WSClient 必填
    appSecret: string                # WSClient 必填
    webhookUrl: string               # 可选（旧版）
    chatId: string                   # 可选，默认推送群
  telegram:
    botToken: string                 # 必填
    chatId: string                   # 可选

daemon:
  poll_interval: string              # 默认 5m

memory:
  forgetting:
    enabled: boolean                 # 默认 true
    initialStability: number         # 默认 24（小时）
    manualStability: number          # 默认 168（小时）
    maxStability: number             # 默认 8760（1年）
    archiveThreshold: number         # 默认 10
    deleteThreshold: number          # 默认 5
    cleanupIntervalHours: number     # 默认 1
  association:
    enabled: boolean                 # 默认 true
    overlapThreshold: number         # 默认 0.3
    maxSpreadDepth: number           # 默认 2
    maxAssociatedResults: number     # 默认 5
  reinforce:
    retrieve: number                 # 默认 1.2
    taskSuccess: number              # 默认 2.0
    taskFailure: number              # 默认 0.8
    manualReview: number             # 默认 1.5
    associationHit: number           # 默认 1.1
  chatMemory:
    enabled: boolean                 # 默认 true
    maxMemories: number              # 默认 5
    extractEveryNTurns: number       # 默认 5
    triggerKeywords: string[]        # 默认 []
  episodic:
    enabled: boolean                 # 默认 true
```

### 环境变量覆盖
| 环境变量 | 覆盖配置项 |
|----------|-----------|
| `CAH_DATA_DIR` | 数据目录路径 |
| `CAH_LARK_APP_ID` | `notify.lark.appId` |
| `CAH_LARK_APP_SECRET` | `notify.lark.appSecret` |
| `CAH_LARK_WEBHOOK_URL` | `notify.lark.webhookUrl` |
| `CAH_TELEGRAM_BOT_TOKEN` | `notify.telegram.botToken` |
| `CAH_BACKEND_TYPE` | `backend.type` |
| `CAH_BACKEND_MODEL` | `backend.model` |

---

## 7. 任务执行流程

```
cah "描述"
  │
  ├─ 1. createTask() → task.json（含 cwd 用于冲突检测）
  │
  ├─ 2. executeTask(task, options)
  │     │
  │     ├─ Phase 1: 准备
  │     │   ├─ analyzeProjectContext() — 分析项目上下文
  │     │   ├─ learnFromHistory() — 学习历史任务
  │     │   ├─ retrieveRelevantMemories() — 检索相关记忆
  │     │   ├─ AI generateWorkflow() — 生成工作流定义
  │     │   ├─ startWorkflow() → instance.json
  │     │   └─ 若 isDirectAnswer → 直接返回，跳过节点执行
  │     │
  │     ├─ Phase 2: 执行
  │     │   ├─ updateTask(status: 'developing')
  │     │   ├─ createRootSpan() — 创建追踪根 Span
  │     │   ├─ createNodeWorker(concurrency=3)
  │     │   ├─ startWorker() — 开始轮询就绪节点
  │     │   └─ 每个节点: executeNode() → invokeBackend(Persona prompt)
  │     │
  │     └─ Phase 3: 完成
  │         ├─ waitForWorkflowCompletion() — 等待所有节点完成
  │         ├─ saveWorkflowOutput() → outputs/result.md
  │         ├─ emitWorkflowCompleted() → 触发通知
  │         └─ updateTask(status: 'completed' | 'failed')
  │
  └─ 3. 后台进程管理
        ├─ spawnTaskProcess() — fork 子进程（后台模式）
        ├─ process.json — 记录 PID
        └─ 孤儿检测 — 每次 CLI 调用时检查
```

### 恢复流程（resume）
```
cah task resume <id>
  ├─ recoverWorkflowInstance() — 加载现有 instance
  ├─ 若有 failed 节点 → 标记为 pending 重试
  ├─ 若全部 pending（进程崩溃前未执行）→ fallback 为重启模式
  └─ enqueueReadyNodesForResume() → 重新入队执行
```

---

## 8. SelfCheck 健康检查项（7 项）

| 检查项 | 文件 | 说明 |
|--------|------|------|
| dataIntegrity | `checks/dataIntegrity.ts` | 数据完整性 |
| processHealth | `checks/processHealth.ts` | 进程健康状态 |
| envIsolation | `checks/envIsolation.ts` | 环境隔离 |
| versionConsistency | `checks/versionConsistency.ts` | 版本一致性 |
| queueHealth | `checks/queueHealth.ts` | 队列健康状态 |
| configValidity | `checks/configValidity.ts` | 配置有效性 |
| backendAvailability | `checks/backendAvailability.ts` | 后端可用性 |

---

## 9. 后端类型

| 后端 | type 值 | 说明 |
|------|---------|------|
| Claude Code CLI | `claude-code` | 默认后端 |
| OpenCode | `opencode` | OpenCode CLI |
| iFlow | `iflow` | iFlow 平台 |
| CodeBuddy | `codebuddy` | CodeBuddy CLI |
| OpenAI Compatible | `openai` | 通用 OpenAI 兼容 API |

---

## 10. 自驱目标（Builtin Goals）

| 类型 | 优先级 | 调度间隔 | 默认启用 | 说明 |
|------|--------|----------|----------|------|
| `health-check` | high | 4h | 是 | 定期健康检查 |
| `evolve` | medium | 8h | 是 | 定期自进化 |
| `cleanup` | low | 6h | 否 | 数据清理 |

---

## 11. 事件驱动架构

- `taskEventBus`（`shared/events/taskEvents.ts`）：task 层发射事件，messaging 层订阅
- 注册点：`messaging/registerTaskEventListeners.ts`
- 调用位置：daemon 启动、子进程启动、CLI 入口
- 事件类型：`task:completed` 等
- `workflowEvents`：工作流内部事件（NodeStarted/Completed/Failed, WorkflowStarted/Completed/Failed/Progress）
