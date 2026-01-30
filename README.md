# Claude Agent Hub

基于 Claude Code 的后台 Agent 调度系统，让 AI Agent 像团队成员一样工作。

## 功能特性

- **多 Agent 系统** - 创建多个具有不同人格的 Agent
- **任务自动化** - 定期轮询任务队列，自动领取和执行
- **智能规划** - Agent 自动分析任务并制定实施计划
- **分支隔离** - 每个任务独立分支，变更可追溯
- **代码审查** - Agent 间交叉审查或自我审查
- **报告驱动** - 所有变更需人工确认后才提交

## 快速开始

```bash
# 安装
npm install -g claude-agent-hub

# 初始化项目配置
cah init

# 最简单的方式 - 直接输入任务
cah "修复我的tickets"

# 从 Markdown 文件创建工作流
cah ~/projects/prd.md

# 启动 Agent 守护进程
cah daemon start

# 查看工作流状态
cah workflow status
```

### 简化命令

```bash
# 直接输入任务描述 - 自动创建并执行
cah "添加用户登录功能"

# 从文件创建工作流 - 自动解析并启动
cah ./requirements.md

# 指定 Agent 执行
cah "优化数据库查询" -a architect

# 只创建不启动
cah ./prd.md --no-start
```

## 项目结构

```
claude-agent-hub/
├── src/
│   ├── cli/              # CLI 命令入口
│   │   ├── index.ts      # @entry 主入口
│   │   └── commands/     # 子命令实现
│   ├── agent/            # Agent 核心逻辑
│   │   ├── createAgent.ts
│   │   ├── runAgent.ts
│   │   └── persona/      # 人格系统
│   ├── task/             # 任务管理
│   │   ├── createTask.ts
│   │   ├── pollTask.ts
│   │   └── taskStore.ts
│   ├── scheduler/        # 调度系统
│   │   ├── createScheduler.ts
│   │   └── jobRunner.ts
│   ├── git/              # Git 操作
│   │   ├── createBranch.ts
│   │   ├── commitChanges.ts
│   │   └── createPullRequest.ts
│   ├── claude/           # Claude Code 集成
│   │   ├── invokeClaudeCode.ts
│   │   └── parseClaudeOutput.ts
│   ├── report/           # 报告生成
│   │   ├── generateReport.ts
│   │   └── formatReport.ts
│   └── config/           # 配置管理
│       ├── loadConfig.ts
│       └── schema.ts
├── docs/
│   └── PRD.md
├── templates/            # 人格模板
│   └── personas/
├── package.json
├── tsconfig.json
└── README.md
```

## 配置文件

项目根目录创建 `.claude-agent-hub.yaml`:

```yaml
# Agent 配置
agents:
  - name: architect
    persona: Architect
    schedule:
      poll_interval: 5m      # 任务轮询间隔
      work_hours: "09:00-18:00"  # 工作时间窗口

  - name: reviewer
    persona: Perfectionist
    role: reviewer           # 专职审查

# 任务配置
tasks:
  default_priority: medium
  max_retries: 3
  timeout: 30m

# Git 配置
git:
  base_branch: main
  branch_prefix: "agent/"
  auto_push: false          # 需要人工确认才推送

# Claude Code 配置
claude:
  model: sonnet             # 默认模型
  max_tokens: 8000
```

## CLI 命令

### 快捷命令

| 命令 | 描述 |
|------|------|
| `cah "任务描述"` | 直接创建并执行任务 |
| `cah ./file.md` | 从 Markdown 创建工作流 |

### 完整命令

| 命令 | 描述 |
|------|------|
| `cah init` | 初始化项目配置 |
| `cah agent create` | 创建新 Agent |
| `cah agent list` | 列出所有 Agent |
| `cah task add` | 添加新任务 |
| `cah task list` | 列出任务队列 |
| `cah workflow create -f file.md` | 从文件创建工作流 |
| `cah workflow list` | 列出所有工作流 |
| `cah workflow status <id>` | 查看工作流状态 |
| `cah workflow approve <wf> <node>` | 审批节点 |
| `cah daemon start` | 启动守护进程 |
| `cah daemon stop` | 停止守护进程 |
| `cah report` | 生成工作报告 |

## Agent 人格

内置人格模板:

| 人格 | 风格 |
|------|------|
| **Architect** | 注重设计模式和抽象，喜欢画架构图 |
| **Pragmatist** | 务实高效，代码简洁直接 |
| **Perfectionist** | 严格的代码质量标准，详细的 review |
| **Explorer** | 积极采用新技术，喜欢重构 |

自定义人格见 `templates/personas/` 目录。

## 工作流程

```
1. 用户添加任务到队列
        ↓
2. Agent 轮询并领取任务
        ↓
3. Agent 分析任务，生成计划
        ↓
4. Agent 创建 feature 分支
        ↓
5. Agent 调用 Claude Code 执行开发
        ↓
6. Agent 执行代码审查
        ↓
7. 生成工作报告
        ↓
8. 用户审批 PR
        ↓
9. 合并到主分支
```

## 技术栈

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **CLI Framework**: Commander.js
- **Task Queue**: BullMQ + Redis
- **Scheduler**: node-cron
- **Process Manager**: PM2 (可选)
- **Storage**: SQLite (本地) / PostgreSQL (团队)

## License

MIT
