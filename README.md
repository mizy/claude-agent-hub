# Claude Agent Hub

> **从工具到生命体 — 一个拥有记忆、本能和进化能力的自驱软件智能体**

自举式 AI 任务系统。用自己来维护和开发自己。目标不是"更好的工具"，而是"有生命力的系统"。

> *selfcheck 是生存本能，selfevolution 是成长欲望，self-drive 是生命的起点。*
> 详见 [VISION.md](./VISION.md)

## 当前能力

- **一行命令** — `cah "重构登录模块"` 自动分析、规划、执行
- **智能 Workflow** — AI 生成执行计划，14 种节点类型，支持条件、循环、并行
- **项目感知** — 自动分析项目结构、框架、规范，生成更精准的任务计划
- **经验学习** — 从过去任务中学习成功模式，任务分类，节点模式提取
- **可观测性** — 进度条 + ETA、趋势分析、执行对比、性能退化检测
- **多后端** — Claude Code / OpenCode / iFlow / CodeBuddy
- **自举** — 用 CAH 开发 CAH，dogfooding 到极致

## 进化路线

```
Phase 1 ✅       Phase 2 🚧       Phase 3 🔜       Phase 4 🔮       Phase 5 ♾️
能做事            能理解            不死              成长              想活
Foundation       Intelligence     Self-Healing     Self-Evolution   Self-Drive
─────────────────────────────────────────────────────────────────────────────►
  CLI/Workflow     项目感知          selfcheck        记忆/进化引擎     本能/意识
  14节点/9人格     经验学习          自愈循环          能力扩展          自驱运行
  多后端           可观测性          环境隔离          Multi-Agent      适应度函数
```

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Claude Agent Hub                          │
├─────────────────────────────────────────────────────────────────────┤
│  CLI Layer                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  cah "task"    task    serve    report    dashboard          │   │
│  └──────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Agent Layer                                                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │ Project        │  │ Execution      │  │ Workflow       │        │
│  │ Context        │  │ History        │  │ Generator      │        │
│  │ (项目分析)     │  │ (经验学习)      │  │ (计划生成)     │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
├─────────────────────────────────────────────────────────────────────┤
│  Workflow Engine                                                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │ State Manager  │  │ Node Worker    │  │ Event Emitter  │        │
│  │ (状态管理)     │  │ (节点执行)      │  │ (事件驱动)     │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
├─────────────────────────────────────────────────────────────────────┤
│  Infrastructure                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │ Multi-Backend  │  │ Task Store     │  │ Report         │        │
│  │ (4种后端)      │  │ (文件存储)      │  │ (报告分析)     │        │
│  └────────────────┘  └────────────────┘  └────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

## 环境要求

- **Node.js** 20.0.0+
- **Claude Code CLI** — 已安装并完成认证

```bash
# 确认 Claude Code 已就绪
claude --version
```

## 安装

```bash
git clone https://github.com/anthropics/claude-agent-hub.git
cd claude-agent-hub
npm install && npm run build && npm link
```

## 快速开始

```bash
# 创建并执行任务
cah "修复登录 bug"

# 前台模式（实时看日志）
cah "添加用户认证" -F

# 后台模式（守护进程调度）
cah serve -D
```

## 命令参考

### 核心命令

```bash
cah "任务描述"             # 创建任务并自动执行
cah "任务描述" -F          # 前台模式，实时输出
cah "任务描述" --no-run    # 仅创建不执行
cah "任务描述" -d <path>   # 指定数据目录
```

### 任务管理 (task)

```bash
cah task list              # 列出任务
cah task show <id>         # 查看详情
cah task logs <id> -f      # 实时查看日志
cah task resume <id>       # 恢复中断的任务
cah task stop <id>         # 停止任务
cah task delete <id>       # 删除任务
cah task stats <id>        # 查看执行统计
```

### 报告分析 (report)

```bash
cah report work            # 工作报告（日报/周报）
  --type daily/weekly
cah report trend           # 趋势分析
  --days 30                # 分析天数
  --period day/week/month  # 统计周期
  --markdown               # 输出 Markdown
cah report live            # 实时状态监控
  --watch                  # 持续监控模式
```

**趋势分析** 包含：
- 任务类型维度统计（git/feature/fix/docs 等）
- 节点组合热力图（常用模式识别）
- 成本优化建议（高成本节点、重试浪费、冗余节点）

**实时监控** 显示：
- 运行中任务进度和 ETA
- 待执行任务队列预览
- 全部任务预估完成时间

### 守护进程 (daemon)

```bash
cah daemon start           # 启动后台调度
cah daemon stop            # 停止
cah daemon status          # 查看状态
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
│  2. 学习历史经验                     │
│     分析相似任务、成功模式、失败教训  │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  3. 生成 Workflow (Claude)          │
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

数据目录默认为 `.cah-data/`，可通过以下方式指定：

```bash
# 使用默认目录
cah "任务描述"

# 通过命令行参数指定（推荐）
cah "任务描述" -d /path/to/data
cah "任务描述" --data-dir ./custom-data

# 通过环境变量指定
CAH_DATA_DIR=/path/to/data cah "任务描述"
```

```
.cah-data/tasks/
└── task-20260201-HHMMSS-xxx/
    ├── task.json          # 任务元数据
    ├── workflow.json      # 生成的 workflow
    ├── instance.json      # 执行状态（唯一数据源）
    ├── stats.json         # 聚合统计（从 instance 派生）
    ├── timeline.json      # 事件时间线
    ├── process.json       # 进程信息
    ├── logs/
    │   ├── execution.log  # 人类可读日志
    │   └── events.jsonl   # 结构化事件流
    └── outputs/
        └── result.md      # 执行报告
```

## 配置

在项目根目录创建 `cah.config.json`：

```json
{
  "notify": {
    "lark": {
      "webhookUrl": "https://open.feishu.cn/..."
    }
  }
}
```

## 开发

```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm test             # 测试
```

## 文档

- [VISION.md](./VISION.md) — 终极愿景：从工具到生命体的进化路线图
- [CLAUDE.md](./CLAUDE.md) — AI 开发指南与模块索引

## License

MIT
