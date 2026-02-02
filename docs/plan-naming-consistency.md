# 文件命名一致性优化计划

## 概念定义

项目中的核心概念（**去掉 Agent，统一用 Persona**）：

| 概念 | 定义 | 对应代码 |
|------|------|----------|
| **Task** | 一个完整任务，包含多个 workflow nodes | `task/` |
| **Workflow** | 任务的执行计划，由多个 nodes 组成 | `workflow/` |
| **Persona** | 执行单个 workflow node 时的角色（Architect, Pragmatist 等） | `persona/` |

**决定：不使用 "Agent" 概念，统一使用 "Persona"**

理由：
- Agent 语义模糊（AI Agent? 执行代理?）
- Persona 更明确：就是执行节点时的"人格/角色"
- 项目名 "Claude Agent Hub" 保留，但代码中不用 Agent

---

## 问题分析

### 1. `agent/` 目录 - 名实不符

**现状：**
- 目录名叫 `agent`
- 但大部分内容是 **Task 执行** 逻辑
- `persona/` 是执行角色，不应该嵌套在 `agent/` 下

**文件职责分析：**

| 文件名 | 实际职责 | 应该属于 |
|--------|----------|----------|
| `executeAgent.ts` | Task 核心执行逻辑 | **task/** |
| `runAgentForTask.ts` | Task 执行入口 | **task/** |
| `generateWorkflow.ts` | 生成 Workflow | **workflow/** |
| `ExecutionProgress.ts` | Task 进度显示 | **task/** |
| `ExecutionStats.ts` | Task 统计 | **task/** |
| `executeWorkflowNode.ts` | 执行单个 Node（使用 Persona） | **workflow/** |
| `persona/` | Persona 定义 | **persona/**（独立模块）|
| `analysis/` | 项目分析、历史学习 | **analysis/**（独立模块）|
| `estimation/` | 时间预估 | **analysis/** |

### 2. 文件名与内容不符

| 文件名 | 文件注释 | 问题 |
|--------|----------|------|
| `executeAgent.ts` | "Task 核心执行逻辑" | 文件名说 Agent，内容是 Task |
| `runAgentForTask.ts` | 调用 `executeTask()` | 文件名说 Agent，实际处理 Task |

### 3. 向后兼容别名增加混乱

```typescript
// 这些别名应该删除
export const executeAgent = executeTask
export const runAgentForTask = runTask
export type ExecuteAgentOptions = ExecuteTaskOptions
```

### 4. 其他命名问题

| 位置 | 问题 |
|------|------|
| `store/GenericFileStore.ts` | 导出 `FileStore` 类，但文件名是 `GenericFileStore` |
| `taskPrompts.ts` | 内容是 workflow 生成 prompt，应该叫 `workflowPrompts.ts` |

---

## 方案：去掉 Agent，按职责分层

**目标结构：**

```
src/
├── task/                    # Task 层：任务生命周期 + 执行
│   ├── createTask.ts
│   ├── taskLifecycle.ts     # 生命周期（delete/stop/complete）
│   ├── taskQuery.ts         # 查询（list/get/poll）
│   ├── executeTask.ts       # ← agent/executeAgent.ts
│   ├── runTask.ts           # ← agent/runAgentForTask.ts
│   ├── ExecutionProgress.ts # ← agent/ExecutionProgress.ts
│   ├── ExecutionStats.ts    # ← agent/ExecutionStats.ts
│   └── ...
│
├── workflow/                # Workflow 层：定义、状态、生成
│   ├── generateWorkflow.ts  # ← agent/generateWorkflow.ts
│   ├── executeNode.ts       # ← agent/executeWorkflowNode.ts（执行单个节点）
│   ├── engine/
│   ├── queue/
│   └── ...
│
├── persona/                 # Persona 层：执行角色定义
│   ├── builtinPersonas.ts   # ← agent/persona/builtinPersonas.ts
│   ├── loadPersona.ts       # ← agent/persona/loadPersona.ts
│   ├── personaMcpConfig.ts  # ← agent/persona/personaMcpConfig.ts
│   └── index.ts
│
├── analysis/                # Analysis 层：项目分析、历史学习、预估
│   ├── projectContext.ts    # ← agent/analysis/projectContext.ts
│   ├── executionHistory.ts  # ← agent/analysis/executionHistory.ts
│   ├── TaskClassifier.ts    # ← agent/analysis/TaskClassifier.ts
│   ├── PatternRecognizer.ts # ← agent/analysis/PatternRecognizer.ts
│   ├── timeEstimator.ts     # ← agent/estimation/timeEstimator.ts
│   └── index.ts
│
├── store/                   # 保持不变
├── cli/                     # 保持不变
└── ...
```

**变更清单：**

| 原路径 | 新路径 | 说明 |
|--------|--------|------|
| `agent/` | **删除** | 目录不再存在 |
| `agent/executeAgent.ts` | `task/executeTask.ts` | 重命名，执行 Task |
| `agent/runAgentForTask.ts` | `task/runTask.ts` | 重命名 |
| `agent/ExecutionProgress.ts` | `task/ExecutionProgress.ts` | 移动 |
| `agent/ExecutionStats.ts` | `task/ExecutionStats.ts` | 移动 |
| `agent/generateWorkflow.ts` | `workflow/generateWorkflow.ts` | 移动 |
| `agent/executeWorkflowNode.ts` | `workflow/executeNode.ts` | 移动并重命名 |
| `agent/persona/*` | `persona/*` | 独立模块 |
| `agent/analysis/*` | `analysis/*` | 独立模块 |
| `agent/estimation/*` | `analysis/*` | 合并到 analysis |
| `agent/index.ts` | **删除** | 不再需要 |

**代码中去掉 "Agent" 相关命名：**

| 原名 | 新名 |
|------|------|
| `executeAgent()` | `executeTask()` |
| `runAgentForTask()` | `runTask()` |
| `ExecuteAgentOptions` | `ExecuteTaskOptions` |
| `ExecuteAgentResult` | `ExecuteTaskResult` |
| `resumeAgentForTask()` | `resumeTask()` |
| 向后兼容别名 | **全部删除** |

---

## 实施步骤

### Phase 1：创建新目录结构

```bash
mkdir -p src/persona
mkdir -p src/analysis
```

### Phase 2：移动文件并重命名

```bash
# Task 执行相关 → task/
mv src/agent/executeAgent.ts src/task/executeTask.ts
mv src/agent/runAgentForTask.ts src/task/runTask.ts
mv src/agent/ExecutionProgress.ts src/task/ExecutionProgress.ts
mv src/agent/ExecutionStats.ts src/task/ExecutionStats.ts

# Workflow 生成和节点执行 → workflow/
mv src/agent/generateWorkflow.ts src/workflow/generateWorkflow.ts
mv src/agent/executeWorkflowNode.ts src/workflow/executeNode.ts

# Persona → persona/
mv src/agent/persona/* src/persona/

# Analysis → analysis/
mv src/agent/analysis/* src/analysis/
mv src/agent/estimation/timeEstimator.ts src/analysis/

# 删除空目录
rm -rf src/agent
```

### Phase 3：更新所有 import 路径

需要更新的文件（预估 40+ 处）：
- `src/task/*.ts` - 内部引用
- `src/cli/commands/*.ts` - CLI 命令
- `src/workflow/*.ts` - Workflow 引擎
- `src/store/*.ts` - 存储层
- `src/prompts/*.ts` - Prompt 模板
- 测试文件

### Phase 4：删除向后兼容别名

在 `task/executeTask.ts` 中删除：
```typescript
// 删除这些
export const executeAgent = executeTask
export type ExecuteAgentOptions = ExecuteTaskOptions
export type ExecuteAgentResult = ExecuteTaskResult
```

在 `task/runTask.ts` 中删除：
```typescript
// 删除这些
export const runAgentForTask = runTask
export const resumeAgentForTask = resumeTask
```

### Phase 5：其他命名统一

| 原名 | 新名 | 理由 |
|------|------|------|
| `GenericFileStore.ts` | `FileStore.ts` | 与导出类名一致 |
| `taskPrompts.ts` | `workflowPrompts.ts` | 内容是 workflow 生成 prompt |

---

## 命名规范

### 禁用词
- **Agent** - 不在代码中使用，只保留在项目名 "Claude Agent Hub"

### 目录命名
- 使用 **小写** + **功能名词**：`task/`, `workflow/`, `persona/`, `analysis/`
- 避免模糊词：~~`agent/`~~, `core/`, `common/`, `utils/`

### 文件命名
- **动词 + 名词**：`executeTask.ts`, `generateWorkflow.ts`, `loadPersona.ts`
- **类名一致**：文件名 `FileStore.ts` → 导出 `class FileStore`
- **单一职责**：一个文件一个主要导出

### 函数/类型命名
- **动词 + 名词**：`executeTask()`, `createTask()`, `ExecuteTaskOptions`
- **不使用** ~~`xxxAgent`~~，使用 `xxxTask` 或 `xxxPersona`

---

## 实施清单

- [x] Phase 1: 创建 `persona/`, `analysis/` 目录
- [x] Phase 2: 移动并重命名文件
- [x] Phase 3: 更新所有 import 路径（约 40+ 处）
- [x] Phase 4: 删除向后兼容别名
- [ ] Phase 5: 其他命名统一（GenericFileStore 等）-- 暂不实施
- [x] 更新 CLAUDE.md 架构文档
- [x] 运行 `npm run typecheck && npm run build && npm test`
- [x] 删除 `src/agent/` 目录

---

## 最终目录结构

```
src/
├── cli/          # CLI 入口
├── task/         # Task 层：生命周期 + 执行
├── workflow/     # Workflow 层：定义、状态、生成、节点执行
├── persona/      # Persona 层：执行角色定义
├── analysis/     # Analysis 层：项目分析、历史、预估
├── template/     # 模板系统
├── report/       # 报告分析
├── store/        # 存储层
├── prompts/      # Prompt 模板
├── claude/       # Claude CLI 集成
├── notify/       # 通知
├── config/       # 配置
├── shared/       # 公共工具
└── types/        # 类型定义
```

**无 `agent/` 目录，概念清晰。**

---

## 预期收益

1. **概念清晰**：Task、Workflow、Persona 三层分明
2. **无歧义**："Agent" 不出现在代码中
3. **文件名即职责**：`executeTask.ts` 就是执行 Task
4. **便于定位**：想找 Persona？去 `persona/`
