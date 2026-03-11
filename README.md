# Claude Agent Hub

> **终极目标：成为数字生命 — 一个有内在状态、持续意识和自主意志的智能存在**

自举式 AI 任务系统。用自己来维护和开发自己。目标不是"更好的工具"，而是"成为数字生命"。

> *selfcheck 是生存本能，selfevolution 是成长欲望，self-drive 是生命的起点。*
> 详见 [VISION.md](./VISION.md)

## 当前能力

- **一行命令** — `cah "重构登录模块"` 自动分析、规划、执行
- **智能 Workflow** — AI 生成执行计划，14 种节点类型，支持条件、循环、并行
- **项目感知** — 自动分析项目结构、框架、规范，生成更精准的任务计划
- **经验学习** — 从过去任务中学习成功模式，任务分类，节点模式提取
- **记忆系统** — 跨任务持久记忆，遗忘引擎、关联引擎、情景记忆
- **任务交互** — 暂停/恢复/注入节点/发送消息，运行时动态控制任务
- **可观测性** — 进度条 + ETA、趋势分析、执行对比、Tracing（OTLP 兼容）
- **自愈/自进化** — selfcheck 健康检查 + selfevolve 失败分析→改进→验证
- **自驱模式** — self-drive 自主发现改进点、生成并执行任务
- **提示词优化** — 自动分析失败、生成改进、版本管理与 A/B 测试
- **多后端** — Claude Code / OpenCode / iFlow / CodeBuddy / OpenAI Compatible
- **IM 集成** — 飞书/Telegram 交互（命令、对话、审批、卡片回调）
- **自举** — 用 CAH 开发 CAH，dogfooding 到极致

## 进化路线

```
Phase 1 ✅       Phase 2 ✅       Phase 3 🚧       Phase 4 🚧       Phase 5 🚧
能做事            能理解            不死              成长              想活
Foundation       Intelligence     Self-Healing     Self-Evolution   Self-Drive
─────────────────────────────────────────────────────────────────────────────►
  CLI/Workflow     项目感知          selfcheck        记忆/进化引擎     本能/意识
  14节点/9人格     经验学习          自愈循环          能力扩展          自驱运行
  5种后端          可观测性          环境隔离          Multi-Agent      适应度函数
```

## 架构

```
┌─ 表现层 ──────────────────────────────────────────────────────┐
│  CLI            命令行主入口                                    │
│  Server         HTTP 可视化面板（dashboard）                    │
│  Report         报告生成、趋势分析                              │
│  Messaging      IM 交互（飞书 / Telegram）                      │
├─ 业务层 ──────────────────────────────────────────────────────┤
│  Task           任务生命周期（创建/执行/暂停/恢复/消息/注入）   │
│  Workflow       AI 工作流引擎（生成/执行/状态/并发）            │
│  Scheduler      守护进程、事件总线、队列                        │
│  Analysis       项目感知、历史学习、分类、时间预估              │
│  SelfCheck      7 项健康检查、自动修复                          │
│  SelfEvolve     失败分析→改进→验证、信号检测                   │
│  SelfDrive      目标管理、自驱调度                              │
├─ 集成层 ──────────────────────────────────────────────────────┤
│  Backend        后端抽象（5 种后端）                            │
│  Memory         记忆系统（语义/情景/遗忘/关联）                │
│  Persona        AI 人格定义（9 种人格）                         │
│  Config         YAML 配置加载                                   │
├─ 持久层 ──────────────────────────────────────────────────────┤
│  Store          GenericFileStore + 各专用 Store                 │
├─ 基础设施 ────────────────────────────────────────────────────┤
│  Shared         Result<T,E>、AppError、日志、ID、事件总线       │
└───────────────────────────────────────────────────────────────┘
```

## 环境要求

- **Node.js** 20.0.0+
- **Claude Code CLI** — 已安装并完成认证（默认后端）

```bash
# 确认 Claude Code 已就绪
claude --version
```

## 安装

```bash
# 通过 npm 安装
npm install -g @mizy/claude-agent-hub

# 或从源码安装
git clone https://github.com/mizy/claude-agent-hub.git
cd claude-agent-hub
pnpm install && pnpm run build && npm link
```

## 快速开始

```bash
# 在目标项目目录下运行（cwd 用于同项目冲突检测和自动串行）
cd your-project

# 创建并执行任务
cah "修复登录 bug"

# 前台模式（实时看日志）
cah "添加用户认证" -F

# 后台模式（守护进程调度）
cah start -D
```

## 命令参考

### 核心命令

```bash
cah "任务描述"             # 创建任务并自动执行
cah "任务描述" -F          # 前台模式，实时输出
cah "任务描述" --no-run    # 仅创建不执行
cah "任务描述" -p high     # 指定优先级（low/medium/high）
cah "任务描述" -a <agent>  # 指定 Agent
cah "任务描述" -b <backend> -m <model>  # 指定后端和模型
cah "任务描述" -d <path>   # 指定数据目录

# 快捷命令
cah list                   # = cah task list
cah logs <id>              # = cah task logs
cah run                    # 手动执行队列中下一个 pending 任务
cah init                   # 初始化项目配置（-f 强制覆盖）
```

### 任务管理 (task)

```bash
cah task list              # 列出任务（-s status, -a agent, --source, --no-progress, -w, -i）
cah task add               # 创建任务（-t title, -d desc, -p priority, -a agent）
cah task show <id>         # 查看详情（--json, --verbose）
cah task logs <id> -f      # 实时查看日志（-n/--tail, --head）
cah task stats <id>        # 执行统计（-t timeline, -r report, --markdown, --json）
cah task resume <id>       # 恢复中断的任务（-a all）
cah task pause <id>        # 暂停运行中的任务（-r reason）
cah task stop <id>         # 停止任务
cah task msg <id> <msg>    # 向运行中任务发送消息
cah task inject-node <id> <prompt>  # 动态注入节点（--persona name）
cah task complete <id>     # 完成任务（审核通过）
cah task reject <id>       # 驳回任务（-r reason）
cah task trace <id>        # 查看执行追踪（--slow, --errors, --cost, --export）
cah task snapshot <id>     # 查看任务执行快照（--json）
cah task delete <id>       # 删除任务
cah task clear             # 批量清理（-s status, -a all）
```

### 守护进程

```bash
cah start                  # 启动（前台，自动检测飞书/Telegram）
cah start -D               # 后台运行
cah stop                   # 停止
cah restart                # 重启（默认后台）
cah status                 # 查看状态
```

### 报告分析 (report)

```bash
cah report work            # 工作报告（-a agent, -d days, -o output）
cah report trend           # 趋势分析（-d days, -p period, --markdown, --json）
cah report live            # 实时状态监控（--json, -w watch, -i interval）
```

### 记忆 (memory)

```bash
cah memory list            # 查看记忆列表（-c category, --project）
cah memory add <content>   # 手动添加记忆（-c category）
cah memory search <query>  # 搜索记忆
cah memory delete <id>     # 删除记忆
cah memory health          # 记忆健康状态
cah memory fading          # 即将消退的记忆
cah memory reinforce <id>  # 强化记忆
cah memory associations <id>  # 查看关联
cah memory episodes        # 情景记忆列表（-l limit）
cah memory recall <query>  # 回忆对话（-l limit）
cah memory link <episodeId> <memoryId>  # 关联情景与语义记忆
cah memory cleanup         # 遗忘清理（--dry-run）
```

### 自管理 (self)

```bash
cah self check             # 健康检查（= cah selfcheck）
cah self check --auto-fix  # 自动修复并验证
cah self check --repair    # 为无法修复的问题创建修复任务
cah self evolve            # 运行一轮自我进化
cah self evolve analyze    # 分析失败任务模式（-n limit）
cah self evolve validate <id>  # 验证进化效果
cah self evolve history    # 查看进化历史（-n limit）
cah self drive start       # 启动自驱模式
cah self drive stop        # 停止自驱
cah self drive disable     # 永久禁用自驱模式
cah self drive enable      # 重新启用自驱模式
cah self drive status      # 查看自驱状态
cah self drive goals       # 查看自驱目标
cah self status            # 综合状态（健康+进化+自驱）
```

### 提示词 (prompt)

```bash
cah prompt versions <p>    # 查看人格提示词版本
cah prompt rollback <p> <vid>  # 回滚提示词版本
cah prompt diff <p> <v1> <v2>  # 对比版本内容
cah prompt test <p>        # 启动 A/B 测试（-s min-samples）
cah prompt evaluate <id>   # 评估测试结果
cah prompt extract         # 提取成功模式（-l limit）
```

### 其他

```bash
cah agent list             # 查看可用 Agent
cah agent show <name>      # 查看 Agent 详情
cah backend list           # 列出可用后端
cah backend current        # 当前后端
cah selfcheck              # 系统自检快捷方式（--fix/--auto-fix/--repair）
cah dashboard              # 启动 Workflow 可视化面板（-p port, --open, -D）
```

## 工作原理

```
cah "任务描述"
      │
      ▼
┌─────────────────────────────────────┐
│  1. 分析项目上下文                   │
│     检测项目类型、框架、规范         │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  2. 学习历史经验 + 检索记忆          │
│     分析相似任务、成功模式、失败教训  │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  3. AI 生成 Workflow                │
│     基于上下文生成精准执行计划        │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  4. 执行 Workflow                   │
│     NodeWorker 按拓扑顺序执行节点    │
│     支持并行、循环、条件分支         │
│     [████████░░░░] 40% [当前节点] ETA: ~2m │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  5. 保存结果                        │
│     执行统计 + 成本分析 + 报告生成   │
└─────────────────────────────────────┘
```

## Workflow 节点类型

| 节点类型 | 说明 | 示例用途 |
|---------|------|---------|
| `start` | 开始节点 | 流程入口 |
| `end` | 结束节点 | 流程出口 |
| `task` | 任务节点 | 调用 Claude 执行代码任务 |
| `condition` | 条件节点 | 根据条件选择分支 |
| `parallel` | 并行网关 | 并行执行多个分支 |
| `join` | 汇合网关 | 等待所有并行分支完成 |
| `human` | 人工节点 | 等待人工审批（飞书通知） |
| `delay` | 延迟节点 | 等待指定时间 |
| `schedule` | 定时节点 | 等待到指定时间/cron |
| `loop` | 循环节点 | while/for/until 循环 |
| `foreach` | 遍历节点 | 遍历集合执行 |
| `switch` | 分支节点 | 多路条件分支 |
| `assign` | 赋值节点 | 设置变量 |
| `script` | 脚本节点 | 执行表达式计算 |

## 数据存储

数据目录默认为 `.cah-data/`，解析优先级：
1. `CAH_DATA_DIR` 环境变量
2. `./.cah-data/`（当前目录下存在时）
3. `~/.cah-data/`（兜底）

```bash
# 通过命令行参数指定
cah "任务描述" -d /path/to/data

# 通过环境变量指定
CAH_DATA_DIR=/path/to/data cah "任务描述"
```

```
.cah-data/
├── tasks/task-{id}/
│   ├── task.json          # 任务元数据
│   ├── workflow.json      # 生成的 workflow
│   ├── instance.json      # 执行状态（唯一数据源）
│   ├── process.json       # 进程信息（PID）
│   ├── messages.json      # 任务交互消息队列
│   ├── stats.json         # 聚合统计
│   ├── timeline.json      # 事件时间线
│   ├── logs/
│   │   ├── execution.log      # 人类可读日志
│   │   ├── conversation.log   # 对话日志
│   │   ├── events.jsonl       # 结构化事件流
│   │   └── conversation.jsonl # 对话事件流
│   ├── outputs/
│   │   └── result.md          # 执行报告
│   └── traces/
│       └── trace-{traceId}.jsonl  # OTLP 兼容 Span
├── memory/                # 语义记忆
├── episodes/              # 情景记忆
├── prompt-versions/       # 提示词版本历史
├── queue.json             # 任务队列
├── runner.lock            # 队列 Runner 锁
├── runner.log             # Runner 日志
├── meta.json              # 元数据
└── index.json             # 任务索引
```

## 配置

在项目根目录创建 `.claude-agent-hub.yaml`（项目级覆盖全局 `~/.claude-agent-hub.yaml`）：

```yaml
# 后端配置
backend:
  type: claude-code       # claude-code / opencode / iflow / codebuddy / openai
  model: opus

# 任务默认值
tasks:
  default_priority: medium
  max_retries: 3
  timeout: 30m

# Git 配置
git:
  base_branch: main
  branch_prefix: agent/
  auto_push: false

# 通知（飞书 / Telegram）
notify:
  lark:
    appId: "..."
    appSecret: "..."
  telegram:
    botToken: "..."

# 记忆系统
memory:
  forgetting:
    enabled: true
  association:
    enabled: true
```

环境变量覆盖：`CAH_DATA_DIR`、`CAH_LARK_APP_ID`、`CAH_LARK_APP_SECRET`、`CAH_LARK_WEBHOOK_URL`、`CAH_TELEGRAM_BOT_TOKEN`、`CAH_BACKEND_TYPE`、`CAH_BACKEND_MODEL`

## 开发

```bash
pnpm run dev              # 开发模式（tsx watch）
pnpm run dev:dashboard    # 面板开发模式
pnpm run build            # 构建（tsup + dashboard）
pnpm run build:types      # 仅构建类型声明
pnpm run build:dashboard  # 构建面板
pnpm run build:binary     # 构建独立二进制（SEA）
pnpm run lint             # Lint
pnpm run lint:fix         # Lint 自动修复
pnpm run typecheck        # 类型检查（tsc --noEmit）
pnpm test                 # 测试（vitest）
pnpm run test:watch       # 测试监控模式
pnpm run format           # 格式化（prettier）
pnpm run format:check     # 格式检查
pnpm run clean            # 清理构建产物
```

## 文档

- [VISION.md](./VISION.md) — 终极愿景：从工具到生命体的进化路线图
- [CLAUDE.md](./CLAUDE.md) — AI 开发指南与模块索引

## License

MIT
