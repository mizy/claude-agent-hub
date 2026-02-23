# Claude Agent Hub

自举式 AI 任务系统 — 用自己来开发自己，目标是从工具进化为有生命力的自驱智能体。

> 愿景详见 [VISION.md](./VISION.md) | 核心 DNA：自举优先、渐进自治、本地优先

## 核心命令

```bash
# 任务（必须在目标项目目录下运行，cwd 用于同项目冲突检测和自动串行）
cah "任务描述"           # 创建并执行任务（-p priority, -a agent, -b backend, -m model）
cah "任务描述" -F        # 前台运行（可看日志）
cah "任务描述" --no-run  # 仅创建不执行
cah list                 # 查看任务列表（快捷方式，支持 -s/-a/--source/--no-progress/-w/-i）
cah logs <id>            # 查看任务日志（快捷方式，支持 -f/-n）
cah run                  # 手动执行队列中下一个 pending 任务
cah init                 # 初始化项目配置（-f 强制覆盖）
cah task list            # 查看任务列表
cah task add             # 创建任务（-t title, -d desc, -p priority, -a agent）
cah task show <id>       # 任务详情（--json, --verbose）
cah task logs <id> -f    # 实时查看任务日志（-n/--tail, --head）
cah task stats <id>      # 执行统计（-t timeline, -r report, --markdown, --json）
cah task resume <id>     # 恢复中断的任务（-a all）
cah task pause <id>      # 暂停运行中的任务（-r reason）
cah task stop <id>       # 停止/取消任务
cah task delete <id>     # 删除任务
cah task clear           # 批量清理（-s status, -a all）
cah task msg <id> <msg>  # 向运行中任务发送消息
cah task inject-node <id> <prompt>  # 动态注入节点（--persona name）
cah task complete <id>   # 完成任务（审核通过）
cah task reject <id>     # 驳回任务（-r reason）
cah task trace <id>      # 查看执行追踪（--slow [ms], --errors, --cost, --export）
cah task snapshot <id>   # 查看任务执行快照（--json）

# 守护进程
cah start                # 启动守护进程（前台，自动检测飞书/Telegram）
cah start -D             # 后台运行（fork 子进程）
cah stop                 # 停止守护进程
cah restart              # 重启守护进程（默认后台，-D）
cah status               # 查看运行状态

# 报告 & 工具
cah report work          # 工作报告（-a agent, -d days, -o output）
cah report trend         # 趋势分析报告（-d days, -p period, --json）
cah report live          # 实时状态监控（--json, -w watch, -i interval）
cah dashboard            # 启动 Workflow 可视化面板（-p port, --open, -D）
cah agent list           # 查看可用 Agent
cah agent show <name>    # 查看 Agent 详情

# 记忆
cah memory list          # 查看记忆列表（-c category, --project）
cah memory add <content> # 手动添加记忆（-c category）
cah memory search <query># 搜索记忆
cah memory delete <id>   # 删除记忆
cah memory health        # 记忆健康状态
cah memory fading        # 即将消退的记忆
cah memory reinforce <id># 强化记忆
cah memory associations <id>  # 查看关联
cah memory episodes      # 情景记忆列表（-l limit）
cah memory recall <query># 回忆对话（-l limit）
cah memory link <episodeId> <memoryId>  # 关联情景与语义记忆
cah memory cleanup       # 遗忘清理（--dry-run）

# 提示词
cah prompt versions <p>  # 查看人格提示词版本
cah prompt rollback <p> <vid>  # 回滚提示词版本
cah prompt diff <p> <v1> <v2>  # 对比版本内容
cah prompt test <p>      # 启动 A/B 测试（-s min-samples）
cah prompt evaluate <id> # 评估测试结果
cah prompt extract       # 提取成功模式（-l limit）

# 自管理
cah self check           # 信号检测（stale daemon、corrupt data 等）
cah self check --auto-fix # 检测并自动修复
cah self evolve          # 运行一轮自我进化
cah self evolve analyze  # 分析失败任务模式（-n limit）
cah self evolve validate <id> # 验证进化效果
cah self evolve history  # 查看进化历史（-n limit）
cah self drive start     # 启动自驱模式
cah self drive stop      # 停止自驱（daemon 重启会恢复）
cah self drive disable   # 永久禁用（daemon 重启不恢复）
cah self drive enable    # 重新启用
cah self drive status    # 查看自驱状态
cah self drive goals     # 查看自驱目标
cah self status          # 综合状态（健康+进化+自驱）

# 后端 & 系统
cah backend list         # 列出可用后端
cah backend current      # 当前后端
```

## 分层架构

```
CLI (cli/)  ─────────────────────────── 表现层：命令行、输出格式化
  ├── Server (server/)                   HTTP 可视化面板（dashboard）
  ├── Report (report/)                   报告生成、趋势分析、退化检测
  └── Messaging (messaging/)             IM 交互层：飞书 WSClient+卡片 / Telegram
        │
Task (task/)  ───────────────────────── 业务层：任务生命周期（创建/执行/暂停/恢复/消息/注入）
  ├── Scheduler (scheduler/)             守护进程、事件总线、队列、Worker
  ├── Workflow (workflow/)               AI 工作流引擎（生成/执行/状态/队列/Worker）
  │     └── engine/ parser/ queue/       子模块
  ├── Analysis (analysis/)               项目分析、历史学习、分类、时间预估
  ├── Output (output/)                   结果保存、标题生成
  ├── SelfEvolve (selfevolve/)           失败分析→改进→验证→历史、信号检测、健康检查+自动修复
  └── SelfDrive (selfdrive/)             目标管理、调度器、daemon 集成、自驱状态
        │
Backend (backend/)  ─────────────────── 集成层：后端抽象（claude-code/opencode/iflow/codebuddy/openai）
Memory (memory/)                         记忆系统（语义/情景/遗忘/关联/检索）
Persona (persona/)                       AI 人格定义与加载
Prompts (prompts/)                       提示词模板
PromptOptimization (prompt-optimization/) 提示词自进化（失败分析/版本/A-B测试）
Config (config/)                         YAML 配置加载、Schema 校验
        │
Store (store/)  ─────────────────────── 持久层：GenericFileStore + 各专用 Store
        │
Shared (shared/)  ───────────────────── 基础设施：Result<T,E>、AppError、日志、ID、时间、文本
Types (types/)                           共享类型定义
```

## @entry 模块索引（26 个）

| 模块 | 入口 | 核心能力 |
|------|------|----------|
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
| SelfEvolve | `selfevolve/index.ts` | 自进化引擎 |
| SelfEvolve/Signal | `selfevolve/signalDetector.ts` | 信号检测 |
| SelfDrive | `selfdrive/index.ts` | 自驱引擎 |
| Config | `config/index.ts` | 配置管理 |
| Types | `types/index.ts` | 类型定义 |
| Prompts | `prompts/index.ts` | 提示词模板 |
| Output | `output/index.ts` | 输出管理 |
| Server | `server/index.ts` | HTTP 面板 |
| PromptOptimization | `prompt-optimization/index.ts` | 提示词优化 |

## 任务执行流程

```
cah "描述" → createTask(含 cwd) → analyzeProjectContext → learnFromHistory
  → retrieveRelevantMemories → AI generateWorkflow → startWorkflow
  → NodeWorker 并发执行节点(Persona) → invokeBackend → saveWorkflowOutput
  → emitWorkflowCompleted → updateTask(completed/failed)
```

恢复流程：`cah task resume <id>` → recoverWorkflowInstance → 有 failed 节点则重试，全 pending 则重启

## 数据结构

数据目录：`.cah-data/`（可通过 `-d <path>` 或 `CAH_DATA_DIR` 指定）

```
.cah-data/
├── tasks/task-{id}/
│   ├── task.json       # 元数据（id, title, status, priority, cwd, source）
│   ├── workflow.json   # 工作流定义（节点、边、变量）
│   ├── instance.json   # 唯一执行状态源（节点状态、输出、变量）
│   ├── process.json    # 后台进程信息（PID）
│   ├── messages.json   # 任务交互消息队列
│   ├── stats.json      # 聚合统计（从 instance 派生）
│   ├── timeline.json   # 事件时间线
│   ├── logs/
│   │   ├── execution.log       # 主执行日志
│   │   ├── conversation.log    # 对话日志
│   │   ├── events.jsonl        # JSONL 事件流
│   │   └── conversation.jsonl  # JSONL 对话流
│   ├── outputs/        # result.md
│   └── traces/         # trace-{traceId}.jsonl（OTLP 兼容 Span 数据）
├── memory/             # 语义记忆条目
├── episodes/           # 情景记忆
├── prompt-versions/    # 提示词版本历史
├── queue.json          # 任务队列
├── runner.lock         # 队列 Runner 锁
├── runner.log          # Runner 日志
├── meta.json           # 元数据
└── index.json          # 任务索引
```

## 开发

```bash
pnpm run dev            # 开发模式（tsx watch）
pnpm run dev:dashboard  # 面板开发模式
pnpm run build          # 构建（tsup + dashboard）
pnpm run build:types    # 仅构建类型声明
pnpm run build:dashboard # 构建面板
pnpm run build:binary   # 构建独立二进制（SEA）
pnpm run lint           # Lint
pnpm run lint:fix       # Lint 自动修复
pnpm run typecheck      # 类型检查（tsc --noEmit）
pnpm test               # 测试（vitest）
pnpm run test:watch     # 测试监控模式
pnpm run format         # 格式化（prettier）
pnpm run format:check   # 格式检查
pnpm run clean          # 清理构建产物
```

## 架构模式

### 事件驱动解耦（task → messaging）
- `taskEventBus`（`shared/events/taskEvents.ts`）：task 层发射事件（如 `task:completed`），messaging 层订阅处理
- `workflowEvents`：工作流内部事件（NodeStarted/Completed/Failed, WorkflowStarted/Completed/Failed/Progress）
- 注册点：`messaging/registerTaskEventListeners.ts`，在 daemon 启动、子进程启动、CLI 入口三处调用
- 目的：打断 task ↔ messaging 循环依赖，task 模块不直接 import messaging

### Backend Registry
- `backend/resolveBackend.ts` 统一注册所有后端（claude-code/opencode/iflow/codebuddy/openai-compatible）
- `backend/backendConfig.ts` 独立提供 `resolveBackendConfig()`，避免 openaiCompatibleBackend ↔ resolveBackend 循环

### 错误处理标准
- 使用 `shared/assertError.ts` 的 `isError()` / `getErrorMessage()` / `ensureError()` 替代 `instanceof Error` 模式
- 所有 `JSON.parse` 调用已在 try-catch 中
- 空 catch 块必须添加 `logger.debug` 日志（除非有明确设计理由如进程退出场景）

## 规范

- 文件/函数: 动词+名词 (`createTask.ts` / `createTask()`)，类: PascalCase
- `@entry` 标记模块入口，每个 index.ts 按功能分组导出
- 单文件不超过 500 行，超出按职责拆分
- 代码注释用英文，CLI 面向用户输出用中文

## 常见问题排查

- **Daemon 不响应**: `cah stop && cah start -D` 重启（或 `cah restart`）；rebuild 后必须重启 daemon 才能加载新代码
- **任务卡在 running**: 检查 `process.json` 中 PID 是否存活（`kill -0 <pid>`），若进程已死则为 orphan，下次 `cah` 调用会自动恢复
- **Orphan detection 误判**: `checkAndResumeOrphanedTasks()` 在每次 CLI 调用时执行，依赖 `process.json` 存在。缺少 process.json 的 running 任务不会被检测到
- **测试删除生产数据**: 测试必须使用隔离数据目录（`vitest.config.ts` 设置 `CAH_DATA_DIR` 为 tmpdir），`tests/setup.ts` 有安全检查拒绝清理非 tmp 目录
- **caffeinate 不生效**: macOS 需要 `-i` flag 防止 idle sleep
- **同项目任务冲突**: `cah` 记录 `cwd` 到 task.json，同 cwd 的任务自动串行。必须在目标项目目录下运行 `cah`，否则冲突检测失效
