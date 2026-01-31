# Claude Agent Hub

基于 Claude Code 的 AI 任务调度系统 - 让 AI Agent 自动分析、规划和执行开发任务。

## 核心特性

- **一行命令** - `cah "重构登录模块"` 创建并自动执行
- **Workflow 引擎** - 支持条件分支、循环、并行、定时等复杂流程
- **人工审批** - 关键节点支持人工介入，集成飞书通知
- **零配置** - 直接使用 Claude Code 认证，开箱即用

## 环境要求

- **Node.js** 20.0.0+
- **Claude Code CLI** - 已安装并完成认证

```bash
# 确认 Claude Code 已就绪
claude --version
```

## 安装

```bash
# 从源码安装
git clone https://github.com/anthropics/claude-agent-hub.git
cd claude-agent-hub
npm install && npm run build && npm link
```

## 快速开始

```bash
# 创建并执行任务
cah "修复登录 bug"

# 前台模式（实时看日志）
cah "添加用户认证" --foreground

# 查看任务状态
cah task list

# 查看任务详情
cah task show <task-id>
```

## CLI 命令

### 核心命令

```bash
cah "任务描述"             # 创建任务并自动执行
cah "任务描述" -f          # 前台模式，实时输出
cah "任务描述" -p high     # 高优先级任务
cah run                    # 执行队列中的待处理任务
```

### 任务管理

```bash
cah task list              # 列出任务
cah task show <id>         # 查看详情（含 workflow 状态）
cah task stop <id>         # 停止任务
cah task delete <id>       # 删除任务
cah task clear             # 清空所有任务
```

### Workflow 管理

```bash
cah workflow list          # 列出 workflow
cah workflow show <id>     # 查看 workflow 详情
cah workflow run <file>    # 从 Markdown 文件运行 workflow
```

### 守护进程

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
│  1. 创建任务                         │
│     生成任务文件夹，状态: pending     │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  2. 生成 Workflow (Claude)          │
│     分析任务 → JSON Workflow         │
│     包含节点和边的 DAG 结构          │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  3. 执行 Workflow                   │
│     NodeWorker 按拓扑顺序执行节点    │
│     支持并行、循环、条件分支等       │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│  4. 保存结果                        │
│     生成 Markdown 报告              │
│     更新任务状态                    │
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

任务数据按状态组织在 `data/tasks/` 下：

```
data/tasks/
├── pending/                          # 待处理
├── planning/                         # 规划中
├── developing/                       # 执行中
│   └── task-20260131-143022-abc/
│       ├── task.json                 # 任务信息
│       ├── workflow.json             # 执行计划
│       ├── instance.json             # 运行状态
│       ├── conversations.json        # AI 对话记录
│       └── outputs/
│           └── result.md             # 执行报告
├── completed/                        # 已完成
├── failed/                           # 失败
└── cancelled/                        # 已取消
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

## 表达式语法

在 `assign`、`script`、`condition` 等节点中使用：

```javascript
// 变量访问
variables.count
outputs.step1.result

// 内置函数
now()                    // 当前时间戳 (Date.now())
floor(x), ceil(x)        // 取整
min(a, b), max(a, b)     // 最值
len(arr)                 // 数组长度
str(x), num(x), bool(x)  // 类型转换

// 也支持 JavaScript 风格（自动转换）
Date.now()               // → now()
Math.floor(x)            // → floor(x)
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
