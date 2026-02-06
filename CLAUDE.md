# Claude Agent Hub

基于 Claude Code CLI 的自举式 AI 任务系统。

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
cah serve                # 启动守护进程（前台，自动检测飞书/Telegram）
cah serve -D             # 后台运行（fork 子进程）
cah stop                 # 停止守护进程
cah status               # 查看运行状态

# 报告 & 工具
cah report trend         # 趋势分析报告
cah report live          # 实时状态监控
cah dashboard            # 启动 Workflow 可视化面板
cah agent list           # 查看可用 Agent
```

## @entry 模块索引

| 模块 | 入口 | 核心能力 |
|------|------|----------|
| CLI | `cli/index.ts` | 命令行主入口、子命令（task/serve/stop/status/report/dashboard） |
| Backend | `backend/index.ts` | CLI 后端抽象层（claude-code/opencode/iflow/codebuddy） |
| Task | `task/index.ts` | 创建、执行（进度条/ETA/统计）、查询、生命周期 |
| Workflow | `workflow/index.ts` | AI 生成工作流、节点执行（Persona）、状态管理、重试 |
| Store | `store/index.ts` | GenericFileStore 通用文件存储、TaskStore/WorkflowStore |
| Analysis | `analysis/index.ts` | 项目上下文分析、历史学习、任务分类、时间预估 |
| Report | `report/index.ts` | 趋势分析、实时摘要、执行对比（退化检测） |
| Persona | `persona/index.ts` | AI 人格定义、加载 |
| Scheduler | `scheduler/index.ts` | 任务队列、Worker、守护进程、事件总线 |
| Notify | `notify/index.ts` | 平台无关 handlers（命令/审批/对话）+ 飞书/Telegram 适配层 |
| Config | `config/index.ts` | 配置加载、Schema |
| Shared | `shared/index.ts` | Result<T,E>、AppError、日志、ID 生成 |

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
npm run dev       # 开发模式
npm run build     # 构建
npm run lint      # Lint
npm run typecheck # 类型检查
npm test          # 测试
```

## 规范

- 文件/函数: 动词+名词 (`createTask.ts` / `createTask()`)，类: PascalCase
- `@entry` 标记模块入口，每个 index.ts 按功能分组导出
- 单文件不超过 500 行，超出按职责拆分
