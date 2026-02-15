# CAH 2026 Self-Evolution Plan

> 自举式进化路线图 — 从工具到有生命力的自驱智能体

## Current State Assessment (Updated 2026-02-13)

- **Phase 1 执行力** ✅ 95% — 14 node types, 9 personas, 4 backends
- **Phase 2 感知力** ✅ 80% — Memory 学习系统、历史分析、Prompt 自动优化、分布式 Tracing
- **Phase 3 自愈力** ❌ 5% — Almost non-existent
- **Phase 4 成长力** 🟡 25% — Prompt optimization + memory system 初步实现，Agent Teams 仍为 prompt-only
- **Phase 5 自驱力** ❌ 0% — No intrinsic motivation

---

## Q1: 修骨 — Critical Fixes & Code Health

### Sprint 1: Critical Defect Fixes (P0)

**1. Fix cron scheduler**
- File: `src/workflow/engine/executeNewNodes.ts` — `calculateNextCronTime()`
- Problem: Ignores cron expression, always returns next hour
- Fix: Use `cron-parser` library to properly parse cron expressions
- Test: Unit tests for various cron patterns (daily, weekly, specific times)

**2. Unify error handling**
- Problem: 50+ silent catch blocks swallowing exceptions across config, analysis, notification modules
- Fix: Audit all catch blocks, add proper logging; adopt Result<T,E> pattern consistently
- Key files: `src/config/loadConfig.ts`, `src/analysis/`, `src/messaging/`

**3. Split executeTask.ts** ✅ Done
- ~~File: `src/task/executeTask.ts`~~
- Split into: `executeTask.ts` (main flow) + `prepareExecution.ts` (preparation) + `taskRecovery.ts` (resume/retry) + `taskNotifications.ts` (progress/completion notifications)
- Hardcoded test check removed

**4. Fix pidLock race condition**
- File: `src/scheduler/pidLock.ts`
- Problem: Doesn't distinguish EPERM from ESRCH in `kill(pid, 0)` check
- Fix: Handle EPERM (process exists but owned by another user) vs ESRCH (process dead)

### Sprint 2: Code Deduplication & Tests

**1. Consolidate duplicated logic** ✅ Partially done
- `toInvokeError()` — ✅ extracted to `src/shared/toInvokeError.ts`
- `truncateText()` — ✅ extracted to `src/shared/truncateText.ts`
- `categorizeTask()` — 3 copies → still needs consolidation
- Expression parser — 2 copies → still needs unification

**2. Split oversized type files** ✅ Done
- `src/workflow/types.ts` — types moved to `src/types/workflow.ts`, factory functions to `src/workflow/factory.ts`; `workflow/types.ts` now re-exports

**3. Create types/index.ts** ✅ Done
- `src/types/index.ts` — barrel export for all type files

**4. Add missing unit tests**
- Target: 15-20 new tests for uncovered critical paths
- Focus: cron parsing, error handling, PID locking, expression evaluation

---

## Q2: 铸盾 — Phase 3 Self-Healing (不死)

### Sprint 3: Selfcheck Framework

**1. Create `src/selfcheck/` module**
- `src/selfcheck/index.ts` — @entry, exports `runSelfcheck()`
- `src/selfcheck/assertions.ts` — individual health check functions
- `src/selfcheck/autoHeal.ts` — automated remediation actions

**2. Implement 12+ health assertions**
- Data integrity: task dirs contain required files (task.json, workflow.json, instance.json)
- Process health: daemon PID alive, no zombie workers
- Version consistency: CLI build matches daemon build
- Disk space: data dir not filling up
- Config validity: loaded config passes schema validation
- Orphan detection: running tasks with dead PIDs
- Store consistency: instanceTaskIdCache matches actual files
- Log file health: no excessive error rates in recent logs
- Backend availability: configured backend CLI exists and responds
- Memory: worker abortControllers set size reasonable
- Network: Lark/Telegram connection alive (if configured)
- Schedule: cron expressions valid and next-fire-time reasonable

**3. CLI command: `cah selfcheck`**
- Run all assertions, color-coded output (green/yellow/red)
- `--fix` flag to auto-remediate fixable issues
- `--json` flag for machine-readable output

**4. Daemon integration**
- Run selfcheck every 30 minutes during daemon operation
- Alert via Lark/Telegram on assertion failures
- Auto-heal for safe remediations (restart worker, clear orphans)

### Sprint 4: Diagnostics Engine

**1. Failure pattern classification**
- Timeout / OOM / Permission / Network / Logic error categories
- Auto-detect from error messages and exit codes
- Store failure patterns in `~/.cah-data/diagnostics/patterns.json`

**2. Remediation suggestions**
- Map failure patterns to fix suggestions
- "Task failed with EACCES" → "Check file permissions on output directory"
- "Backend timeout after 300s" → "Consider splitting into smaller nodes"

**3. Config validation enhancement**
- Detect unused config fields
- Warn on common misconfigurations
- Suggest optimal settings based on task history

---

## Q3: 进化 — Phase 4 Growth (成长)

### Sprint 5: Deep Learning

**1. Failure pattern catalog**
- Persistent database of failure → root cause → fix mappings
- File: `src/analysis/failureCatalog.ts`
- Auto-populated from task execution history
- Query: "What caused similar failures before?"

**2. Capability boundary tracking**
- Track success rate by task type, complexity, project
- File: `src/analysis/capabilityTracker.ts`
- Know what CAH is good at vs what it struggles with
- Inform workflow generation: "This task type has 30% success rate, consider simpler approach"

**3. Cross-project knowledge transfer**
- Extract reusable patterns from successful workflows
- File: `src/analysis/knowledgeTransfer.ts`
- "Project A's API integration pattern works for Project B too"
- Shared pattern library in `~/.cah-data/knowledge/`

### Sprint 6: Real Multi-Agent System

**1. Agent runtime (replace prompt-only simulation)**
- File: `src/agent/runtime.ts`
- Each agent is a real execution context with its own backend session
- Inter-agent message passing via event bus

**2. Team workflow templates**
- Architect → Coder → Tester pipeline as first-class workflow pattern
- File: `src/agent/teamWorkflow.ts`
- Configurable team compositions per task type

**3. Collaboration mechanics**
- Agent proposes → team reviews → conflicts resolved → merged output
- Voting mechanism for design decisions
- Delegation: if agent fails, route to specialist

---

## Q4: 觉醒 — Phase 5 Self-Drive (想活)

### Sprint 7: Intrinsic Motivation System

**1. Adaptive scheduling**
- High backlog → increase poll frequency
- Idle → decrease frequency, run selfcheck instead
- File: `src/scheduler/adaptiveScheduler.ts`

**2. Self-improvement triggers**
- Detect capability gaps from failure patterns
- Auto-create learning tasks: "Practice tasks of type X to improve success rate"
- File: `src/selfevolution/improvementTrigger.ts`

**3. Cost consciousness**
- Track token usage per task
- Select model by task complexity (haiku for simple, opus for complex)
- Budget alerts and per-task cost limits
- File: `src/selfevolution/costOptimizer.ts`

### Sprint 8: Survival Instinct

**1. Proactive health monitoring**
- Daemon-internal periodic selfcheck (not waiting for CLI invocation)
- Anomaly detection: sudden increase in failure rate, unusual resource consumption
- File: `src/selfcheck/proactiveMonitor.ts`

**2. Self-healing closed loop**
- Detect → Diagnose → Fix → Verify cycle
- Safe auto-fixes: restart daemon, clear orphans, rebuild index
- Escalate to human for dangerous fixes (data migration, config changes)

**3. Capability expansion**
- When encountering unknown task types, explore and document approach
- Extend node type library based on recurring needs
- File: `src/selfevolution/capabilityExpander.ts`

---

## Already Achieved (Since Initial Plan)

以下能力在 Q1 期间已实现，超出原计划范围：

### Memory 学习系统 ✅
- `src/memory/` — 5 类记忆（pattern/lesson/preference/pitfall/tool）
- 关键词+项目+时间衰减评分的相关性检索
- 从任务执行自动提取记忆
- 注入 Prompt 供后续任务使用

### Prompt 自动优化 ✅
- `src/prompt-optimization/` — 失败分析 + Textual Gradient 改进
- Prompt 版本管理（active/candidate/retired 状态）
- 按 persona 追踪成功率和执行时长

### 分布式 Tracing ✅
- `src/store/TraceStore.ts` + `createSpan.ts` + `exportOTLP.ts`
- 4 层 Span 层次（workflow → node → llm → tool/internal）
- OpenTelemetry 兼容格式
- Dashboard TraceTab 可视化

### 任务交互系统 ✅
- `src/task/pauseResumeTask.ts` + `injectNode.ts`
- `src/store/TaskMessageStore.ts` — 消息队列
- CLI: `cah task pause/resume/msg/inject`
- IM: `/pause`, `/resume`, `/inject` 命令

### notify → messaging 重构 ✅
- 从 `src/notify/` 重命名为 `src/messaging/`
- 新增 `larkCards/` 子模块、`larkEventRouter.ts`
- handlers 层新增 `systemCommands.ts`、`streamingHandler.ts`

---

## P0 Blockers (Must Fix First)

1. **Cron scheduler** — broken `calculateNextCronTime()` blocks all scheduling autonomy
2. **Selfcheck framework** — no self-diagnosis = no self-healing = no autonomy
3. **Silent error handling** — 50+ catch blocks hiding failures = lying to ourselves

## Success Metrics

- **Q1 end**: 0 known P0 bugs, 90%+ test coverage on critical paths, executeTask.ts < 200 lines ✅ (partial)
- **Q2 end**: `cah selfcheck` passes 12+ assertions, daemon auto-heals 3+ failure types
- **Q3 end**: Failure catalog has 50+ entries, real multi-agent pipeline executes end-to-end
- **Q4 end**: CAH creates and completes self-improvement tasks without human initiation
