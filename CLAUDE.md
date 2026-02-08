# Claude Agent Hub

自举式 AI 任务系统 — 用自己来开发自己，目标是从工具进化为有生命力的自驱智能体。

> 愿景详见 [VISION.md](./VISION.md) | 核心 DNA：自举优先、渐进自治(selfcheck)、本地优先

## 核心命令

```bash
# 任务
cah "任务描述"           # 创建并执行任务
cah "任务描述" -F        # 前台运行（可看日志）
cah "任务描述" --no-run  # 仅创建不执行
cah task list            # 查看任务列表
cah task logs <id> -f    # 实时查看任务日志
cah task resume <id>     # 恢复中断的任务

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
```

## 分层架构

```
CLI (cli/)  ─────────────────────────── 表现层：命令行、输出格式化
  ├── Server (server/)                   HTTP 可视化面板
  ├── Report (report/)                   报告生成、趋势分析
  └── Notify (notify/)                   飞书(卡片交互)/Telegram 通知
        │
Task (task/)  ───────────────────────── 业务层：任务生命周期
  ├── Scheduler (scheduler/)             守护进程、队列、Worker
  ├── Workflow (workflow/)               AI 工作流引擎、节点执行
  │     └── engine/ parser/ queue/       子模块
  ├── Analysis (analysis/)               项目分析、历史学习
  └── Output (output/)                   结果保存、标题生成
        │
Backend (backend/)  ─────────────────── 集成层：CLI 后端抽象
Persona (persona/)                       AI 人格定义
Prompts (prompts/)                       提示词模板
        │
Store (store/)  ─────────────────────── 持久层：文件存储
Config (config/)                         配置加载
Shared (shared/)                         基础设施（Result/AppError/logger）
Types (types/)                           类型定义
```

## @entry 模块索引

| 模块 | 入口 | 核心能力 |
|------|------|----------|
| CLI | `cli/index.ts` | 命令行主入口、子命令（task/start/stop/restart/status/report/dashboard） |
| Backend | `backend/index.ts` | CLI 后端抽象层（claude-code/opencode/iflow/codebuddy） |
| Task | `task/index.ts` | 创建、执行（进度条/ETA/统计）、查询、恢复、生命周期 |
| Workflow | `workflow/index.ts` | AI 生成工作流、节点执行（Persona）、状态管理、重试 |
| Store | `store/index.ts` | GenericFileStore 通用文件存储、TaskStore/WorkflowStore |
| Analysis | `analysis/index.ts` | 项目上下文分析、历史学习、任务分类、时间预估 |
| Report | `report/index.ts` | 趋势分析、实时摘要、执行对比（退化检测） |
| Persona | `persona/index.ts` | AI 人格定义、加载 |
| Scheduler | `scheduler/index.ts` | 任务队列、Worker、守护进程、PID 锁 |
| Notify | `notify/index.ts` | 平台无关 handlers（命令/审批/对话）+ 飞书(卡片交互、按钮回调)/Telegram 适配层 |
| Config | `config/index.ts` | YAML 配置加载、Schema 校验、项目初始化 |
| Shared | `shared/index.ts` | Result<T,E>、AppError、日志、ID 生成、格式化 |
| Output | `output/index.ts` | 任务输出保存、标题生成 |
| Server | `server/index.ts` | HTTP server、Workflow 可视化面板 |
| Prompts | `prompts/index.ts` | 任务执行/对话提示词模板 |
| Types | `types/` | 类型定义（task, taskStatus, nodeStatus, persona, output） |

## 任务执行流程

`cah "描述"` → 创建 task → 分析项目上下文 → 学习历史 → AI 生成 workflow → NodeWorker 执行节点(Persona) → 调用 Backend → 结果写入 instance.json

## 数据结构

数据目录：`.cah-data/`（可通过 `-d <path>` 或 `CAH_DATA_DIR` 指定）

```
.cah-data/tasks/task-{id}/
├── task.json       # 元数据（id, title, status, priority）
├── workflow.json   # 工作流定义（节点、边、变量）
├── instance.json   # 唯一执行状态源（节点状态、输出、变量）
├── stats.json      # 聚合统计（从 instance 派生）
├── timeline.json   # 事件时间线（含 instanceId）
├── process.json    # 后台进程信息
├── logs/           # execution.log + events.jsonl
└── outputs/        # result.md
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
