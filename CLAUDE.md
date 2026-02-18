# Claude Agent Hub

自举式 AI 任务系统 — 用自己来开发自己，目标是从工具进化为有生命力的自驱智能体。

> 愿景详见 [VISION.md](./VISION.md) | 核心 DNA：自举优先、渐进自治(selfcheck)、本地优先

## 核心命令

```bash
# 任务（必须在目标项目目录下运行，cwd 用于同项目冲突检测和自动串行）
cah "任务描述"           # 创建并执行任务
cah "任务描述" -F        # 前台运行（可看日志）
cah "任务描述" --no-run  # 仅创建不执行
cah list                 # 查看任务列表（快捷方式）
cah task list            # 查看任务列表
cah task logs <id> -f    # 实时查看任务日志
cah task resume <id>     # 恢复中断的任务
cah task pause <id>      # 暂停运行中的任务
cah task stop <id>       # 停止/取消任务
cah task msg <id> <msg>  # 向运行中任务发送消息
cah task inject-node <id> <prompt>  # 动态注入节点
cah task complete <id>   # 完成任务（审核通过）
cah task reject <id>     # 驳回任务
cah task trace <id>      # 查看执行追踪（调用树/耗时/错误链）
cah task snapshot <id>   # 查看任务执行快照

# 守护进程
cah start                # 启动守护进程（前台，自动检测飞书/Telegram）
cah start -D             # 后台运行（fork 子进程）
cah stop                 # 停止守护进程
cah restart              # 重启守护进程
cah status               # 查看运行状态

# 报告 & 工具
cah report trend         # 趋势分析报告
cah report live          # 实时状态监控
cah dashboard            # 启动 Workflow 可视化面板
cah agent list           # 查看可用 Agent

# 记忆
cah memory list          # 查看记忆列表
cah memory add <content> # 手动添加记忆
cah memory search <query># 搜索记忆
cah memory health        # 记忆健康状态
cah memory fading        # 即将消退的记忆
cah memory reinforce <id># 强化记忆
cah memory associations <id>  # 查看关联
cah memory episodes      # 情景记忆列表
cah memory recall <query># 回忆对话
cah memory cleanup       # 遗忘清理

# 提示词
cah prompt versions <p>  # 查看人格提示词版本
cah prompt rollback <p> <vid>  # 回滚提示词版本
cah prompt diff <p> <v1> <v2>  # 对比版本内容
cah prompt test <p>      # 启动 A/B 测试
cah prompt evaluate <id> # 评估测试结果

# 自管理
cah self check           # 健康检查（= cah selfcheck）
cah self check --auto-fix # 自动修复并验证
cah self evolve          # 运行一轮自我进化
cah self evolve analyze  # 分析失败任务模式
cah self evolve validate <id> # 验证进化效果
cah self evolve history  # 查看进化历史
cah self drive start     # 启动自驱模式
cah self drive stop      # 停止自驱
cah self drive status    # 查看自驱状态
cah self drive goals     # 查看自驱目标
cah self status          # 综合状态（健康+进化+自驱）

# 后端 & 系统
cah backend list         # 列出可用后端
cah backend current      # 当前后端
cah selfcheck            # 系统自检（快捷方式）
```

## 分层架构

```
CLI (cli/)  ─────────────────────────── 表现层：命令行、输出格式化
  ├── Server (server/)                   HTTP 可视化面板
  ├── Report (report/)                   报告生成、趋势分析
  └── Messaging (messaging/)              IM 交互层：飞书/Telegram（命令/对话/通知/卡片）
        │
Task (task/)  ───────────────────────── 业务层：任务生命周期（含暂停/恢复/注入/消息）
  ├── Scheduler (scheduler/)             守护进程、队列、Worker
  ├── Workflow (workflow/)               AI 工作流引擎、节点执行
  │     └── engine/ parser/ queue/       子模块
  ├── Analysis (analysis/)               项目分析、历史学习
  └── Output (output/)                   结果保存、标题生成
        │
Backend (backend/)  ─────────────────── 集成层：后端抽象（CLI + OpenAI API）
Persona (persona/)                       AI 人格定义
Prompts (prompts/)                       提示词模板
Memory (memory/)                         任务记忆：学习、检索、注入
PromptOptimization (prompt-optimization/) 提示词自进化：失败分析、版本管理
SelfEvolve (selfevolve/)                 自进化引擎：失败分析→改进→验证→历史
SelfDrive (selfdrive/)                   自驱引擎：目标管理、调度、daemon 集成
        │
Store (store/)  ─────────────────────── 持久层：文件存储、Trace（OTLP 兼容）
Config (config/)                         配置加载
Shared (shared/)                         基础设施（Result/AppError/logger）
Types (types/)                           类型定义
```

## @entry 模块索引

| 模块 | 入口 | 核心能力 |
|------|------|----------|
| CLI | `cli/index.ts` | 命令行主入口、子命令（task/start/stop/restart/status/report/dashboard/memory/prompt） |
| Backend | `backend/index.ts` | CLI 后端抽象层（claude-code/opencode/iflow/codebuddy/openai-compatible） |
| Task | `task/index.ts` | 创建、执行（进度条/ETA/统计）、查询、恢复、暂停/恢复、消息、节点注入 |
| Workflow | `workflow/index.ts` | AI 生成工作流、节点执行（Persona）、状态管理、重试 |
| Store | `store/index.ts` | GenericFileStore 通用文件存储、TaskStore/WorkflowStore/TraceStore/PromptVersionStore |
| Analysis | `analysis/index.ts` | 项目上下文分析、历史学习、任务分类、时间预估 |
| Report | `report/index.ts` | 趋势分析、实时摘要、执行对比（退化检测） |
| Persona | `persona/index.ts` | AI 人格定义、加载 |
| Scheduler | `scheduler/index.ts` | 任务队列、Worker、守护进程、PID 锁 |
| Messaging | `messaging/index.ts` | 平台无关 handlers（命令/审批/对话）+ 飞书(卡片交互、按钮回调)/Telegram 适配层 |
| Memory | `memory/index.ts` | 任务记忆提取、检索（相关性评分）、格式化注入 |
| PromptOptimization | `prompt-optimization/index.ts` | 失败分析、提示词改进生成、版本管理与回滚 |
| Config | `config/index.ts` | YAML 配置加载、Schema 校验、项目初始化 |
| Shared | `shared/index.ts` | Result<T,E>、AppError、日志、ID 生成、格式化 |
| Output | `output/index.ts` | 任务输出保存、标题生成 |
| Server | `server/index.ts` | HTTP server、Workflow 可视化面板 |
| Prompts | `prompts/index.ts` | 任务执行/对话提示词模板 |
| SelfEvolve | `selfevolve/index.ts` | 失败分析、改进应用、进化验证、历史记录、进化周期编排 |
| SelfDrive | `selfdrive/index.ts` | 目标管理、调度器、daemon 集成、自驱状态持久化 |
| Types | `types/index.ts` | 类型定义（task, workflow, persona, output, trace, promptVersion） |

## 任务执行流程

`cah "描述"` → 创建 task → 分析项目上下文 → 学习历史 → AI 生成 workflow → NodeWorker 执行节点(Persona) → 调用 Backend → 结果写入 instance.json

## 数据结构

数据目录：`.cah-data/`（可通过 `-d <path>` 或 `CAH_DATA_DIR` 指定）

```
.cah-data/
├── tasks/task-{id}/
│   ├── task.json       # 元数据（id, title, status, priority）
│   ├── workflow.json   # 工作流定义（节点、边、变量）
│   ├── instance.json   # 唯一执行状态源（节点状态、输出、变量）
│   ├── stats.json      # 聚合统计（从 instance 派生）
│   ├── timeline.json   # 事件时间线（含 instanceId）
│   ├── process.json    # 后台进程信息
│   ├── messages.json   # 任务交互消息队列
│   ├── logs/           # execution.log + events.jsonl
│   ├── outputs/        # result.md
│   └── traces/         # trace-{traceId}.jsonl（OTLP 兼容 Span 数据）
├── memory/             # 记忆条目
├── prompt-versions/    # 提示词版本历史
├── queue.json          # 任务队列
└── runner.lock         # 队列 Runner 锁
```

## 开发

```bash
pnpm run dev          # 开发模式（tsx watch）
pnpm run build        # 构建（tsup）
pnpm run lint         # Lint
pnpm run lint:fix     # Lint 自动修复
pnpm run typecheck    # 类型检查（tsc --noEmit）
pnpm test             # 测试（vitest）
pnpm run format       # 格式化（prettier）
pnpm run format:check # 格式检查
```

## 架构模式

### 事件驱动解耦（task → messaging）
- task 层通过 `shared/events/taskEvents.ts` 的 `taskEventBus` 发射事件（如 `task:completed`），messaging 层订阅处理
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
