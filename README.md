# Claude Agent Hub

基于 Claude Code 的 AI 团队协作系统 —— 让多个 AI Agent 像真实团队一样协作完成任务。

## 核心理念

传统的 AI 工具是单一执行者，而 Claude Agent Hub 模拟真实团队协作：

```
用户需求 → 动态生成 Workflow → 分配给不同角色的 Agent → 协作完成
```

- **动态规划** - 根据任务自动生成执行计划，不是固定流程
- **角色分工** - 不同人格的 Agent 各司其职（架构师、开发者、审查员）
- **真实协作** - Agent 之间可以交叉审查、反馈、迭代
- **零配置** - 直接使用 Claude Code 的认证，开箱即用

## 环境要求

- **Node.js** 20.0.0+
- **Claude Code CLI** - 已安装并完成认证
- **Git** - 用于分支管理

```bash
# 确认 Claude Code 已就绪
claude --version
```

## 安装

```bash
# 全局安装
npm install -g claude-agent-hub

# 或从源码
git clone https://github.com/anthropics/claude-agent-hub.git
cd claude-agent-hub
npm install && npm run build && npm link
```

## 快速开始

```bash
# 添加任务
cah task add "重构用户认证模块，支持 OAuth2"

# 执行任务
cah run

# 查看结果
cah task list
cah task detail <task-id>
```

## CLI 命令

### 核心命令

```bash
cah run                    # 执行待处理任务
cah task add "描述"        # 添加任务
cah task list              # 查看任务列表
```

### 任务管理

```bash
cah task add "描述" [-p high|medium|low]   # 添加任务
cah task list                              # 列出任务
cah task detail <id>                       # 查看详情
cah task stop <id>                         # 停止任务
cah task delete <id>                       # 删除任务
cah task clear                             # 清空所有任务
```

### 工作流

```bash
cah workflow create -f requirements.md    # 从 Markdown 创建工作流
cah workflow list                         # 列出工作流
cah workflow status <id>                  # 查看状态
```

### 守护进程

```bash
cah daemon start    # 启动后台调度
cah daemon stop     # 停止
cah daemon status   # 查看状态
```

## 数据存储

所有数据存储在 `data/` 文件夹，无需数据库：

```
data/tasks/
├── pending/                   # 待处理
├── developing/                # 执行中
└── completed/                 # 已完成
    └── 2026-01-30/
        └── Refactor_auth_a1b2c3d4.json
```

任务 JSON 包含执行计划、Claude Code 输出和耗时统计。

## 工作原理

```
用户添加任务 → 生成执行计划 → 创建分支 → 调用 Claude Code 执行 → 保存结果
```

## 开发

```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm test             # 测试
```

## License

MIT
