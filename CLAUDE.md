# Claude Agent Hub

## 项目概述
基于 Claude Code 的后台 Agent 调度系统，让 AI Agent 像团队成员一样工作。

## 架构

```
src/
├── cli/                    # CLI 命令入口
│   ├── index.ts           # @entry 主入口
│   ├── output.ts          # 统一输出格式
│   ├── spinner.ts         # loading 状态
│   ├── prompt.ts          # 交互式提示
│   └── commands/          # 子命令
│
├── shared/                 # 公共基础设施（纯函数）
│   ├── result.ts          # Result<T, E> 类型
│   ├── error.ts           # 统一错误类型
│   ├── logger.ts          # 日志系统
│   ├── id.ts              # ID 生成
│   └── time.ts            # 时间处理
│
├── scheduler/              # 调度核心
│   ├── eventBus.ts        # 事件总线
│   ├── queue.ts           # 任务队列
│   ├── worker.ts          # Worker 抽象
│   └── startDaemon.ts     # 守护进程
│
├── agent/                  # Agent 核心逻辑
├── task/                   # 任务管理
├── claude/                 # Claude Code 集成
├── git/                    # Git 操作
├── report/                 # 报告生成
├── config/                 # 配置管理
├── store/                  # SQLite 存储
└── types/                  # 类型定义
```

## 核心模块

### shared/ - 公共基础设施
- `Result<T, E>`: 统一处理成功/失败，避免 try-catch 污染
- `AppError`: 按领域分类的错误类型
- `Logger`: 支持级别控制的日志系统
- 纯函数设计，无副作用

### scheduler/ - 任务调度
- `eventBus`: 发布订阅模式，模块间解耦
- `queue`: 基于优先级的任务队列
- `worker`: 可复用的后台任务执行器

### store/ - 数据存储
- 使用 better-sqlite3
- 所有操作返回 Result 类型
- 支持事务

## 命名约定
- 文件名: 动词 + 名词 (`createAgent.ts`, `pollTask.ts`)
- 函数: 动词 + 名词 (`createAgent`, `updateTask`)
- `@entry` 标记主入口点

## 关键文件
- `src/cli/index.ts`: @entry CLI 主入口
- `src/agent/runAgent.ts`: Agent 主运行循环
- `src/claude/invokeClaudeCode.ts`: Claude Code 调用
- `src/shared/result.ts`: Result 类型定义
- `src/scheduler/worker.ts`: Worker 抽象

## 技术栈
- Node.js 20+, TypeScript 5.5+
- Commander.js (CLI)
- better-sqlite3 (存储)
- node-cron (调度)
- execa (进程)
- zod (配置验证)
- chalk/ora (终端 UI)

## 开发命令
```bash
npm run dev          # 开发模式
npm run build        # 构建
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
npm run typecheck    # 类型检查
npm test             # 运行测试
```
