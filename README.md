# Claude Agent Hub

> **成为开发者的自主进化伙伴 — 让每个开发者都拥有一支永不疲倦的 AI 工程团队**

基于 Claude Code CLI 的自举式 AI 任务系统。用自己来维护和开发自己。

## 特性

- **一行命令** — `cah "重构登录模块"` 自动分析、规划、执行
- **智能 Workflow** — AI 生成执行计划，支持条件、循环、并行等复杂流程
- **项目感知** — 自动分析项目结构、框架、规范，生成更精准的任务计划
- **历史学习** — 从过去任务中学习成功模式，任务分类，节点模式提取
- **时间预估** — 基于历史数据预估剩余时间，ETA 显示，置信度标识
- **趋势分析** — 成功率追踪、类型统计、节点热力图、成本优化建议
- **执行对比** — 性能退化检测，相似任务自动对比，趋势分析
- **模板系统** — 12 个内置模板，智能推荐，有效性评分，从历史任务创建
- **实时监控** — 可视化进度条，任务队列预览，全局 ETA
- **零配置** — 直接使用 Claude Code 认证，开箱即用

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Claude Agent Hub                          │
├─────────────────────────────────────────────────────────────────────┤
│  CLI Layer                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  cah "task"    task    template    report    daemon          │   │
│  └──────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Agent Layer                                                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │
│  │ Project        │  │ Execution      │  │ Workflow       │        │
│  │ Context        │  │ History        │  │ Generator      │        │
│  │ (项目分析)     │  │ (历史学习)      │  │ (计划生成)     │        │
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
│  │ Claude Code    │  │ Task Store     │  │ Report         │        │
│  │ Integration    │  │ (文件存储)      │  │ (报告分析)     │        │
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

# 使用模板快速创建任务
cah template use feature --var name="用户认证"
```

## 命令参考

### 核心命令

```bash
cah "任务描述"             # 创建任务并自动执行
cah "任务描述" -F          # 前台模式，实时输出
cah "任务描述" --no-run    # 仅创建不执行
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

### 模板系统 (template)

```bash
cah template list          # 列出所有模板
cah template show <id>     # 查看模板详情
cah template use <id>      # 使用模板创建任务
  --var name=value         # 传入变量
cah template search <q>    # 搜索模板
cah template create        # 创建自定义模板
cah template suggest <d>   # 根据描述推荐模板
cah template from-task [id]  # 从历史任务创建模板
cah template ranking       # 模板有效性排行榜
cah template recalculate   # 重新计算有效性评分
```

**内置模板**：
| 类型 | 模板 |
|------|------|
| 开发 | feature, fix-bug, api-endpoint |
| 测试 | unit-test, integration-test |
| 重构 | refactor, extract-component |
| 文档 | docs, readme |
| DevOps | ci-cd, docker |
| 分析 | performance, code-review |

**模板推荐**：系统会根据任务描述自动推荐最匹配的模板，评分基于关键词匹配、标签匹配、任务类型、历史有效性等维度。

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

数据目录默认为 `.cah-data/`，可通过环境变量 `CAH_DATA_DIR` 覆盖。

```bash
# 使用默认目录
cah "任务描述"

# 使用自定义目录
CAH_DATA_DIR=/path/to/data cah "任务描述"
```

```
.cah-data/tasks/
└── task-20260201-HHMMSS-xxx/
    ├── task.json          # 任务元数据
    ├── workflow.json      # 生成的 workflow
    ├── instance.json      # 执行状态
    ├── stats.json         # 执行统计
    ├── process.json       # 进程信息
    └── logs/
        └── execution.log  # 执行日志
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

## 相关文档

- [VISION.md](./VISION.md) — 项目愿景、使命和路线图
- [CLAUDE.md](./CLAUDE.md) — AI 开发指南
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录

## License

MIT
