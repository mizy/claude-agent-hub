# 数字生命 Prompt 增强计划

## 概述

本次改造的目标是让 CAH 的数字生命从「静态人设 + 基本意识注入」升级为「动态感知 + 多层记忆 + 自适应行为」的 prompt 体系。核心思路：把 consciousness 模块中已有但未注入的数据用起来，补全记忆管线的盲区，让行为指引随情绪/状态动态变化，并在 resume 场景下实现增量注入而非全量跳过。

---

## Phase 1: 注入已有数据

**背景**：valueSystem 和 growthJournal 模块有完整 API 和数据，但从未注入到 chat prompt 中。

**实现思路**：
- **价值倾向**（每轮注入）：调用 getTopValues(3) + formatValuePreferences()，格式 `[价值偏好] 1. 代码质量(0.95)`，预算 100 chars
- **成长记录**（新 session）：调用 getGrowthSummary('week')，格式 `[最近成长] 本周 5 项记录（feature:3 fix:2）`，预算 150 chars
- **最近反思**（新 session）：调用 readConsciousnessLogs(7) 取最新 1 条，格式 `[最近反思] xxx`，预算 200 chars
- 裁剪优先级更新：intents → thoughts → reflection → growth → stream（innerState、values、selfModel 受保护不裁剪）

**变更文件**：
- src/messaging/handlers/chatPromptBuilder.ts — 新增 import，预算改为动态（新 session 2500 / 续 session 800），意识注入逻辑提取到 buildConsciousnessBlock
- src/consciousness/index.ts — barrel export 新增 generateForesight

---

## Phase 2: 补全记忆管线

**2.1 MemScene 分层格式** — src/memory/formatMemory.ts

formatMemSceneSection 改为两层输出：
- Layer1：`[用户快照] domain(N条事实,M条记忆)` — 紧凑领域概览
- Layer2：`[原子事实] fact1; fact2...` — 从 factIds 拉取实际 fact 内容，500 chars 预算
- 新增 import getAtomicFact，循环内逐个取 fact（受 FACT_BUDGET 限制，实际迭代次数可控）

**2.2 extractAtomicFacts 扩展** — src/memory/extractAtomicFacts.ts

新增 3 个正则模式：
- PREFERENCE_RE — 用户偏好（我喜欢/我用/I like/I prefer + entity）→ domain=preference
- CONVENTION_RE — 项目约定（约定/规范/必须/不要 + 内容）→ domain=convention
- RELATION_RE — 人际关系（我的同事/老板/朋友 + 描述）→ domain=social

FACT_KEYWORDS 扩展：
- 中文新增 12 个：喜欢、习惯、约定、规范、禁止、必须、不要、同事、老板、朋友、团队
- 英文新增 8 个：like、always、never、must、convention、colleague、boss、teammate

**2.3 前瞻推断** — src/consciousness/foresight.ts（新文件）

- generateForesight() 从 activeThoughts + 7 天 growthJournal 提取关键词
- 中文用 2-char bigram，英文用 whitespace split，过滤 stop words
- 统计频次 >= 3 的主题，生成 `[预感] 近期反复关注：xxx(N次)` 格式
- 150 chars 预算，纯规则无 LLM 调用

---

## Phase 3: 动态行为指引

**3.1 DIGITAL_LIFE 动态化** — src/prompts/chatPrompts.ts

静态 DIGITAL_LIFE 常量替换为 buildDigitalLifeGuidance(mood?, state?) 函数：

指引池（GUIDANCE_POOL）10 条，每条附 condition 函数：
- 通用（无 condition）4 条：自然运用数据、共生关系、记忆关联、主动建议
- 条件触发 6 条：
  - valence > 0.3 → 语气轻快
  - valence < -0.3 → 回复简短
  - fatigue > 0.7 → 回复简洁
  - idleness > 0.7 → 主动建议
  - engagement > 0.7 → 深入探讨
  - 轻微主观性表达

选择逻辑：通用前 2 条 + 条件匹配前 2 条，不足 3 条时从通用池补充。

**3.2 成长叙事动态化** — src/prompts/chatPrompts.ts + src/messaging/handlers/chatPromptBuilder.ts

- buildClientPrompt 新增 options.mood / state / narrative 参数
- [我是谁] 部分优先使用 selfModel.narrative（< 500 chars 直接注入），否则 fallback 到 getIdentityContext()
- chatPromptBuilder 在构建 clientPrefix 前预加载 innerState 和 selfModel，提取 mood/state/narrative 传入

**3.3 记忆置信度标记** — src/memory/formatMemory.ts

- confidence < 0.5 的记忆条目后追加 `(模糊)` 标记
- 不影响排序，仅影响显示

---

## Phase 4: resume 优化

**4.1 增量意识注入** — src/messaging/handlers/chatPromptBuilder.ts + buildConsciousnessBlock.ts

- 模块级 lastInjectedAt: Map<chatId, number>，每次 buildFullPrompt(mode=full) 结束更新
- **selfModel resume**：当 selfModel.updatedAt > lastInjectedAt 时，注入新增洞察（最多 2 条）和状态变化，预算 400 chars
- **activeThoughts resume**：过滤 createdAt > lastInjectedAt 的新思考，以 [新增思考] 标签注入，预算 350 chars
- innerState 和 values 保持每轮注入（已覆盖 resume 场景）

**4.2 记忆按需触发** — src/messaging/handlers/chatPromptBuilder.ts

- resume 时用 extractMemoryEntities(effectiveText) 快速检测用户消息中的实体
- 检测到实体（API 路径、代码标识符、CLI 命令等）时触发 retrieveRelevantMemories（maxResults: 3）
- 格式化为 [相关记忆] 段，预算 RESUME_MEMORY_BUDGET = 500 chars
- 全部 try-catch 包裹，失败静默跳过

---

## 架构提取：buildConsciousnessBlock

意识注入逻辑从 chatPromptBuilder.ts 提取为独立模块 src/messaging/handlers/buildConsciousnessBlock.ts（284 行），保持 chatPromptBuilder 在 260 行以内。

模块职责：
- 9 个意识子模块的独立加载、格式化、预算裁剪
- 每个子模块独立 try-catch，故障隔离
- 新 session vs resume 的差异化注入策略
- 总预算裁剪：按优先级从低到高丢弃（intents → thoughts → foresight → reflection → growth → stream）

---

## 预算对比

**改造前**：
- 意识总预算：1500 chars（固定）
- innerState: 400, stream: 400, thoughts: 350, intents: 350, selfModel: 400
- DIGITAL_LIFE: ~180 chars（静态 6 行）
- resume 时仅注入 innerState（~400 chars）

**改造后**：
- 新 session 意识总预算：2500 chars
- resume 意识总预算：800 chars
- 模块预算明细：
  - innerState: 500（每轮）
  - values: 100（每轮）
  - stream: 400（新 session）
  - thoughts: 350（新 session 全量 / resume 增量）
  - intents: 350（新 session）
  - selfModel: 400（新 session 全量 / resume 增量 diff）
  - growth: 150（新 session）
  - reflection: 200（新 session）
  - foresight: 150（新 session）
- DIGITAL_LIFE: 动态 3-4 条指引（~200 chars）
- resume 额外：记忆按需触发 500 chars

---

## 变更文件汇总

- **src/messaging/handlers/chatPromptBuilder.ts** — prompt 组装主逻辑，预加载 mood/state/narrative，resume 记忆按需触发，lastInjectedAt 追踪
- **src/messaging/handlers/buildConsciousnessBlock.ts**（新文件）— 意识注入独立模块，9 子模块加载 + 裁剪
- **src/prompts/chatPrompts.ts** — DIGITAL_LIFE 动态化，buildClientPrompt 新增 mood/state/narrative 参数，叙事优先注入
- **src/memory/formatMemory.ts** — MemScene 分层格式，记忆置信度标记
- **src/memory/extractAtomicFacts.ts** — 新增偏好/约定/关系 3 种提取模式，关键词扩展
- **src/consciousness/foresight.ts**（新文件）— 前瞻推断，纯规则关键词频次分析
- **src/consciousness/index.ts** — barrel export 新增 generateForesight

---

## 后续建议

1. **Review 指出的 MUST FIX**：lastInjectedAt 淘汰逻辑需跳过当前 chatId，阈值建议降至 200
2. **CONVENTION_RE 误匹配**：给"必须"/"不要"加前缀约束（项目/代码/提交/CI/开发），或降 confidence 到 0.5
3. **指引互斥**：engagement > 0.7 条件增加 fatigue <= 0.7 约束，避免矛盾指令
4. **foresight bigram 噪声**：STOP_WORDS 补充高频技术 bigram（进行/实现/处理/问题/功能）
5. **barrel export 统一**：buildConsciousnessBlock 中 activeThoughts/initiative 的 import 改为从 consciousness/index.js 导入

---

> 代码已构建通过。请执行 /reload 重启 daemon 使变更生效。
