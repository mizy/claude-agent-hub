---
name: cah
description: "Claude Agent Hub — delegate complex tasks to background AI agents, manage task queues, run multi-step workflows, and chat with AI. Use this skill whenever the user mentions background tasks, task delegation, running something in the background, task queues, workflow execution, cah commands, AI agents, daemon management, or wants to offload work to a separate process. Also trigger when users ask about task status, logs, reports, scheduling recurring jobs, managing AI backends, statistics/stats, dashboard visualization, self-management (evolve/drive/check), memory management, or prompt versioning. Even if they don't say 'cah' explicitly — if they want to run, queue, schedule, or monitor AI-powered tasks, this is the right skill."
---

# Claude Agent Hub (CAH) Skill

CAH 是基于 Claude Code CLI 的自举式 AI 任务系统，可以将复杂任务委派给后台 AI Agent 执行。

## 重要：必须在目标项目目录下运行

**`cah` 会记录当前工作目录（cwd），同项目的任务自动串行执行，防止并发冲突。**

```bash
# CORRECT — 在项目目录下运行
cd /path/to/my-project
cah "重构 auth 模块"

# WRONG — 在错误目录运行，cwd 不对，冲突检测失效
cd ~
cah "重构 /path/to/my-project 的 auth 模块"
```

## 核心命令

### 创建并执行任务

```bash
# 基础用法 - 后台执行
cah "任务描述"

# 前台运行（可实时查看日志）
cah "任务描述" -F

# 仅创建任务，不执行
cah "任务描述" --no-run

# 指定数据目录
cah "任务描述" -d /path/to/data

# 指定优先级 (low/medium/high)
cah "任务描述" -p high

# 指定执行 Agent
cah "任务描述" -a <agent>

# 指定后端 (claude-code/opencode/iflow/codebuddy/cursor)
cah "任务描述" -b cursor -m gpt-4o
cah "任务描述" --backend claude-code --model sonnet

# 定时执行 (cron 表达式)
cah "任务描述" -S "0 9 * * *"

# 显示详细日志
cah "任务描述" -v
```

### 任务管理

```bash
# 查看任务列表（两种方式等价）
cah list
cah ls                          # list 的别名
cah task list

# 查看特定状态的任务
cah list --status running
cah list --status completed
cah list --status failed

# 列表选项
cah list -w                     # 持续更新模式
cah list -i 3000                # 更新间隔（毫秒）
cah list --no-progress          # 隐藏进度显示
cah list -a <agent>             # 按 Agent 筛选
cah list --source <source>      # 按来源筛选（如 selfdrive）
cah list --project              # 只显示当前目录的任务
cah list --cwd <path>           # 按项目目录筛选

# 添加任务（不自动执行）
cah task add -t "任务标题"
cah task add -t "标题" -d "描述" -p high -a <agent> -b <backend> -m <model>

# 查看任务详情
cah task show <task-id>
cah task get <task-id>          # show 的别名
cah task get <task-id> --json   # JSON 格式输出
cah task get <task-id> --verbose # 详细信息（含节点状态）

# 实时查看任务日志
cah task logs <task-id> -f
cah task logs <task-id> --tail <lines>  # 最后 N 行（默认 50）
cah task logs <task-id> --head <n>  # 前 N 行

# 查看任务执行统计
cah task stats <task-id>
cah task stats <task-id> -t         # 显示执行时间线
cah task stats <task-id> -r         # 生成完整执行报告
cah task stats <task-id> --markdown # Markdown 格式报告
cah task stats <task-id> -o <file>  # 保存报告到文件
cah task stats <task-id> --json     # JSON 格式

# 恢复中断的任务
cah task resume <task-id>
cah task resume --all            # 恢复所有孤立任务

# 暂停运行中的任务
cah task pause <task-id>
cah task pause <task-id> -r "原因"  # 附带暂停原因

# 完成任务（审核通过）
cah task complete <task-id>
cah task done <task-id>         # complete 的别名

# 驳回任务（退回重做）
cah task reject <task-id>
cah task reject <task-id> -r "需要补充测试"  # 附带原因

# 停止/取消任务
cah task stop <task-id>

# 向运行中的任务发送消息
cah task msg <task-id> <message>

# 动态注入节点到工作流
cah task inject-node <task-id> <prompt>
cah task inject-node <task-id> <prompt> --agent <name>  # 指定 Agent

# 查看执行追踪（调用树/耗时/错误链）
cah task trace <task-id>
cah task trace <task-id> --slow [ms]   # 显示慢 span（默认阈值 1000ms）
cah task trace <task-id> --errors      # 只显示错误链
cah task trace <task-id> --cost        # 显示成本归因
cah task trace <task-id> --export      # 导出 OTLP JSON 格式

# 查看任务执行快照
cah task snapshot <task-id>
cah task snapshot <task-id> --json

# 删除任务
cah task delete <task-id>
cah task rm <task-id>           # delete 的别名

# 清理终态任务（completed/failed/cancelled）
cah task clear
cah task clear -s completed     # 仅清理已完成任务
cah task clear --all            # 清理所有任务（包括运行中的）
```

### 守护进程

```bash
# 启动守护进程（前台，自动检测飞书/Telegram）
cah start

# 后台运行（fork 子进程）
cah start -D

# 停止守护进程
cah stop
cah stop -a <agent>              # 只停止指定 Agent

# 重启守护进程
cah restart [-D]

# 查看运行状态
cah status

# 守护进程日志
cah daemon logs
cah daemon logs -f               # 持续跟踪
cah daemon logs -n <lines>       # 最后 N 行
cah daemon logs -e               # 只看错误日志
```

### 报告与分析

```bash
# 工作报告
cah report work
cah report work -a <agent>       # 按 Agent 筛选
cah report work -d <days>        # 指定天数（默认 1）
cah report work -o <file>        # 保存到文件

# 趋势分析报告
cah report trend
cah report trend --json          # JSON 格式输出
cah report trend -d <days>       # 指定天数（默认 30）
cah report trend -p <period>     # 统计周期 (day/week/month，默认 week)
cah report trend --markdown      # Markdown 格式
cah report trend -o <file>       # 保存到文件

# 实时状态监控
cah report live
cah report live --json           # JSON 格式
cah report live -w               # 持续监控模式
cah report live -i <ms>          # 刷新间隔（默认 3000ms）
```

### 快捷命令

```bash
# 查看日志（等价于 cah task logs）
cah logs <task-id>
cah logs <task-id> -f            # 持续跟踪
cah logs <task-id> -n <lines>    # 最后 N 行（默认 50）

# 手动执行队列中下一个待处理任务
cah run

# 项目初始化
cah init
cah init -f                      # 强制覆盖已有配置
```

### 系统自管理

```bash
# 系统自检与健康检查
cah self check
cah self check --fix               # 自动修复检测到的问题
cah self check --auto-fix          # 自动修复并验证

# 查看综合状态
cah self status

# 自我进化
cah self evolve                  # 执行完整进化周期
cah self evolve analyze          # 分析失败任务模式
cah self evolve validate <id>    # 验证进化效果
cah self evolve history          # 查看进化历史
cah self evolve intents          # 意图列表（-m/--mine, --json）
cah self evolve proposals        # 提案列表（-a/--all）

# 自驱模式
cah self drive start|stop|disable|enable|status
cah self drive goals             # 自驱目标管理
cah self drive goals list        # 列出目标（默认）
cah self drive goals enable <id> # 启用目标
cah self drive goals disable <id> # 禁用目标
cah self drive goals set-schedule <id> "<cron>"  # 设置目标调度
```

### 定时任务管理

```bash
# 创建定时任务
cah schedule create "0 9 * * *" "任务描述"
cah schedule add "0 9 * * *" "任务描述" -a coder -b claude-code -m sonnet

# 列出定时任务
cah schedule list
cah schedule ls

# 停止定时任务
cah schedule stop <task-id>
```

### 统计

```bash
# 系统统计
cah stats overview               # 系统概览统计
cah stats overview -f            # 强制重新计算（忽略缓存）
cah stats chat                   # 对话使用统计
cah stats task                   # 任务执行统计
cah stats growth                 # 增长趋势统计
cah stats selfdrive              # 自驱目标统计
cah stats <subcommand> --json    # JSON 格式输出
```

### 对话命令

```bash
# 一次性对话
cah chat "你好"
cah chat "你好" -m opus -b claude-code
cah chat "你好" -o json          # 输出格式 (text/json/stream-json)
cah chat                         # 交互式 REPL 模式（TTY 环境）
```

### Agent 管理

```bash
# 查看可用 Agent
cah agent list

# 查看 Agent 详情（系统提示词、特性）
cah agent show <name>
```

### 后端管理

```bash
# 列出所有可用后端
# 支持: claude-code / opencode / iflow / codebuddy / cursor
cah backend list

# 查看当前使用的后端和模型
cah backend current
```

### Dashboard

```bash
# 启动 Workflow 可视化面板
cah dashboard
cah dashboard start -p <port>    # 指定端口（默认 7788）
cah dashboard start -H <host>    # 监听地址（默认 localhost）
cah dashboard start --open       # 启动后自动打开浏览器
cah dashboard start -D           # 后台运行

# 停止面板
cah dashboard stop

# 查看面板状态
cah dashboard status
```

### 记忆管理

```bash
# 查看记忆列表
cah memory list
cah memory list -c <category>    # 按类别过滤
cah memory list --project        # 只显示当前项目记忆

# 手动添加记忆
cah memory add <content>
cah memory add <content> -c <category>  # 指定类别（默认 lesson）

# 搜索记忆
cah memory search <query>

# 删除记忆
cah memory delete <id>
cah memory rm <id>               # delete 的别名

# 记忆健康状态（强度、消退预估）
cah memory health

# 查看即将消退的记忆（强度 < 30%）
cah memory fading

# 手动强化记忆
cah memory reinforce <id>

# 查看记忆关联关系
cah memory associations <id>
cah memory assoc <id>            # 别名

# 情景记忆（对话回忆）
cah memory episodes              # 列出情景记忆
cah memory episodes -l <n>       # 限制数量（默认 20）
cah memory recall <query>        # 回忆特定对话（支持时间表达式如 "yesterday"）
cah memory recall <query> -l <n> # 限制返回数量（默认 3）

# 关联情景记忆和语义记忆
cah memory link <episodeId> <memoryId>

# 执行遗忘清理
cah memory cleanup
cah memory cleanup --dry-run     # 预览，不实际删除
```

### 提示词版本管理

```bash
# 查看人格提示词版本
cah prompt versions <agent>

# 回滚提示词版本
cah prompt rollback <agent> <version-id>

# 对比两个版本的 prompt 内容
cah prompt diff <agent> <v1> <v2>

# 对比两个版本的效果指标
cah prompt compare <agent> <v1> <v2>

# 启动 A/B 测试
cah prompt test <agent>
cah prompt test <agent> -s <n>   # 最小样本数（默认 5）

# 评估 A/B 测试结果
cah prompt evaluate <test-id>

# 从成功任务提取 workflow 模式
cah prompt extract
cah prompt extract -l <n>          # 最大模式数量（默认 20）
```

## 使用场景

### 1. 委派复杂任务

当有复杂的开发任务时，使用 CAH 在后台执行：

```bash
# 重构某个模块
cah "重构 src/utils 目录，将工具函数按功能分类"

# 添加新功能
cah "为用户管理模块添加批量导入功能"

# 修复 Bug
cah "修复登录页面在移动端显示错乱的问题"

# 编写测试
cah "为 src/services/auth.ts 编写单元测试"

# 指定后端和模型
cah "生成 API 文档" -b cursor -m gpt-4o
```

### 2. 任务交互与审核

任务运行中可以实时交互：

```bash
# 暂停任务，稍后恢复
cah task pause <task-id>
cah task resume <task-id>

# 给运行中的任务发消息（补充需求、修正方向）
cah task msg <task-id> "请也处理一下边界情况"

# 动态注入新节点（在当前节点后追加执行步骤）
cah task inject-node <task-id> "补充：添加单元测试覆盖"

# 审核完成的任务
cah task complete <task-id>                   # 通过
cah task reject <task-id> -r "缺少错误处理"   # 驳回
```

### 3. 批量处理

```bash
# 依次执行多个任务（同项目自动串行）
cah "升级所有依赖到最新版本" -p high
cah "修复升级后的类型错误"
cah "运行测试确保功能正常"
```

### 4. 监控与调试

```bash
# 查看运行中的任务
cah list --status running

# 实时跟踪日志
cah logs task-xxx -f

# 查看执行追踪（性能分析/错误定位）
cah task trace task-xxx
cah task trace task-xxx --errors   # 只看错误链
cah task trace task-xxx --cost     # 成本归因

# 查看整体进度
cah report live

# 系统自检
cah self check
```

## 任务数据结构

数据目录查找顺序（优先级从高到低）：
1. 命令行参数 `-d /path/to/data`
2. 环境变量 `CAH_DATA_DIR`
3. 用户主目录 `~/.cah-data/`（默认）

任务数据存储结构：

```
.cah-data/
├── tasks/{uuid}/
│   ├── task.json          # 任务元数据（id, title, status, priority）
│   ├── workflow.json      # 工作流定义（节点、边、变量）
│   ├── instance.json      # 唯一执行状态源（节点状态、输出、变量）
│   ├── stats.json         # 聚合统计（从 instance 派生）
│   ├── timeline.json      # 事件时间线（含 instanceId）
│   ├── process.json       # 后台进程信息
│   ├── messages.json      # 任务交互消息队列
│   ├── logs/              # execution.log, conversation.log, events.jsonl, conversation.jsonl
│   ├── outputs/           # result.md
│   └── traces/            # trace-{traceId}.jsonl（OTLP 兼容 Span 数据）
├── memory/                # 记忆条目
├── episodes/              # 情景记忆
├── prompt-versions/       # 提示词版本历史
├── sessions.json          # 会话管理
├── chat-buffers.json      # IM 聊天缓冲
├── chat-sessions/         # 聊天会话数据
├── selfdrive/             # 自驱动数据
├── evolution/             # 自进化数据
├── failure-kb/            # 失败知识库
├── success-patterns/      # 成功模式
├── consciousness/         # 意识系统（growth-journal.jsonl, value-system.json, intents.json）
├── self-model.json        # 意识自模型
├── reflections.jsonl      # 反思日志
├── consciousness.jsonl    # 意识流日志
├── conversation.jsonl     # 全局 IM 对话日志
├── queue.json             # 任务队列
├── runner.lock            # 队列 Runner 锁
├── runner.log             # 队列运行日志
├── daemon.pid             # Daemon 进程 PID
├── dashboard.pid          # Dashboard 进程 PID
└── tmp/                   # 临时文件
```

## Workflow 执行流程

1. 创建任务 → 生成 task.json
2. 分析项目上下文
3. 学习历史经验（Memory 检索相关记忆）
4. AI 生成 workflow.json（多节点工作流）
5. 按顺序执行各节点（使用不同 Agent）
6. 结果写入 instance.json 和 result.md
7. 提取记忆 → 存入 Memory（供后续任务学习）

## 最佳实践

### 任务描述要清晰

```bash
# Good - 清晰具体
cah "在 src/components/Button 组件中添加 loading 状态支持，包括 loading 属性和旋转动画"

# Bad - 太模糊
cah "改进按钮"
```

### 不要用 shell `&` 后台运行

```bash
# WRONG - shell & 会导致 task.json 写入不完整，cah task list 看不到任务
cah "任务描述" &

# CORRECT - cah 默认就是后台 spawn 子进程，直接运行即可
cah "任务描述"

# 需要看实时日志时用 -F 前台模式
cah "任务描述" -F
```

### 同项目任务自动串行

```bash
# 同一项目目录下的任务自动排队，不会互相干扰
cd /path/to/project-a
cah "任务1"   # 立即执行
cah "任务2"   # 排队等任务1完成

# 不同项目的任务可以并行
cd /path/to/project-b
cah "任务3"   # 与 project-a 不冲突，立即执行

# 用 list 跟踪
cah list
```

### 合理设置优先级

```bash
# 紧急任务
cah "修复生产环境 Bug" -p high

# 常规任务（默认 medium）
cah "添加新功能"

# 低优先级
cah "代码优化" -p low
```

## 配置

**唯一配置文件：`~/.claude-agent-hub.yaml`**（不使用 config.json 或其他格式）

Backend 只需写 `type` 和 `model`，其余字段（`enableAgentTeams`、`chat`、`session` 等）走 schema 默认值：

```yaml
backends:
  claude:
    type: claude-code
    model: opus
  cursor:
    type: cursor
  codebuddy:
    type: codebuddy
    model: glm-4.7
defaultBackend: claude
```

环境变量可覆盖部分字段：

```bash
export CAH_DATA_DIR=/path/to/data    # 数据目录（默认 ~/.cah-data/）
export CAH_BACKEND_TYPE=cursor       # 后端类型
export CAH_LARK_APP_ID=xxx           # 飞书 App ID
```

## 故障排查

### Daemon 不响应

```bash
# 重启守护进程
cah restart

# 或手动停止再启动
cah stop && cah start -D

# rebuild 后必须重启 daemon 才能加载新代码
```

### 任务卡住

```bash
# 查看任务状态
cah task get <task-id>

# 查看日志
cah task logs <task-id>

# 查看执行追踪定位问题
cah task trace <task-id>

# 必要时停止并重试
cah task stop <task-id>
cah task resume <task-id>
```

### 任务失败

```bash
# 查看失败原因
cah task logs <task-id>

# 查看 trace 定位错误链
cah task trace <task-id> --errors

# 手动恢复
cah task resume <task-id>

# 恢复所有孤立任务
cah task resume --all
```

## 与 Claude Code 配合

CAH 本身基于 Claude Code，可以在 Claude Code 会话中使用：

```bash
# 在当前会话中委派子任务
cah "为刚才写的函数添加测试" -F

# 后台处理耗时任务
cah "分析整个项目的代码质量并生成报告"
```
