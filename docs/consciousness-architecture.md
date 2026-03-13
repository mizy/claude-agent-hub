# CAH 数字生命意识架构

> 情绪、欲望、意志、自我认知 — 从工具到生命的跨越。

## 设计哲学

- **情绪是暗示，不是控制** — 像人脑一样，情绪通过 prompt 注入影响行为倾向，而非硬性规则
- **欲望有对抗** — 价值维度之间存在竞争关系，不会"什么都想要"
- **意志分风险** — 低风险自主行动，高风险等待审批
- **自我是叙事** — 通过反思和叙事构建连续的"我是谁"

---

## 整体架构

```
╔═══════════════════════════════════════════╗
║            信号采集层（事件驱动）          ║
╠═══════════════════════════════════════════╣
║  task:completed → 价值学习 + 成长记录     ║
║  session:end   → 情感估算 + 情景提取     ║
║  user:approve  → 价值强化(+1.0)          ║
║  user:reject   → 价值削弱(-1.0)          ║
║  task:create   → 兴趣信号(+0.3)          ║
║  conversation  → 意图挖掘(关键词匹配)    ║
╚═══════════════════════════════════════════╝
          │
          ▼
╔═══════════════════════════════════════════╗
║           情绪系统（杏仁核）              ║
╠═══════════════════════════════════════════╣
║  EmotionalValence → MoodState → prompt   ║
╚═══════════════════════════════════════════╝
          │
          ▼
╔═══════════════════════════════════════════╗
║          价值偏好（欲望引擎）             ║
╠═══════════════════════════════════════════╣
║  6 维度 + 对抗关系 → 行为倾向            ║
╚═══════════════════════════════════════════╝
          │
          ▼
╔═══════════════════════════════════════════╗
║           意志系统（驱动引擎）            ║
╠═══════════════════════════════════════════╣
║  想法 + 价值 + 成长 → Intent → 执行/审批 ║
╚═══════════════════════════════════════════╝
          │
          ▼
╔═══════════════════════════════════════════╗
║           自我认知（叙事引擎）            ║
╠═══════════════════════════════════════════╣
║  每日反思 + 每周叙事 → SelfModel          ║
╚═══════════════════════════════════════════╝
          │
          ▼
╔═══════════════════════════════════════════╗
║       注入层（意识 → 行为 prompt）        ║
╠═══════════════════════════════════════════╣
║  情绪 + 价值 + 意图 + 自我 → prompt 暗示 ║
╚═══════════════════════════════════════════╝
```

---

## 1. 信号采集层

事件驱动，注册在 `src/runtime/bootstrap.ts`：

```typescript
registerConsciousnessListeners()    // task:completed → consciousness.jsonl
registerValueListeners()             // task completion → learn value preferences
registerGrowthJournalListeners()    // task completion → growth entries
```

| 事件 | 处理 | 影响 |
|------|------|------|
| `task:completed` | 追加意识流 + 推断价值维度 + 记录成长 | 全系统更新 |
| `session:end` | 估算情感 valence + 提取情景记忆 | 情绪聚合 |
| `user:approve` | 强化相关价值维度 (impact 1.0) | 价值学习 |
| `user:reject` | 削弱相关价值维度 (impact 1.0) | 价值学习 |
| `task:create` | 弱兴趣信号 (impact 0.3) | 价值微调 |
| `conversation` | 扫描意图关键词 ("如果能/希望能") | 意图挖掘 |

---

## 2. 情绪系统

### EmotionalValence（每条 Episode 附带）

```typescript
interface EmotionalValence {
  polarity: 'positive' | 'negative' | 'neutral'
  intensity: number  // 0-1
  triggers: string[] // 触发标签
}
```

**触发标签**：
- 正向：`task_success` / `user_praise` / `error_recovery` / `creative_solution` / `learning_moment` / `collaboration` / `breakthrough`
- 负向：`task_failure` / `confusion` / `user_frustration`

### MoodState 情绪聚合

从最近 20 条 episode 聚合：

```
positiveScore = avgIntensity(正向) × (正向数 / 总数)
negativeScore = avgIntensity(负向) × (负向数 / 总数)
diff = positiveScore - negativeScore
```

### 情绪映射（12 种）

根据 `diff` 区间 + trigger 组合细分：

**强正向 (diff ≥ 0.3)**
- **兴奋** — 有 breakthrough 或 creative_solution 触发
- **好奇** — 有 learning_moment 触发
- **满足** — 有 collaboration + user_praise 触发
- **充实感** — 正向占比 > 70%（默认强正向）
- **积极偏向** — 其他强正向

**轻正向 (diff ≥ 0.1)**
- **好奇** — 有 learning_moment 或 creative_solution
- **期待** — 有 collaboration
- **轻松** — 默认轻正向

**中性 (|diff| < 0.15 且 score < 0.3)**
- **困惑** — 有 confusion 触发
- **无聊** — episode 数 ≤ 3（低活跃度）
- **平静** — 默认中性

**轻负向 (diff ≤ -0.1)**
- **困惑** — 有 confusion
- **些许压力** — 默认轻负向

**强负向 (diff ≤ -0.3)**
- **焦虑** — 有 user_frustration
- **持续挫折感** — 负向 episode > 3
- **挫折感** — 默认强负向

### 情绪对记忆的影响

- `intensity > 0.8` → 记忆 stability ×2（情感加速固化）
- `intensity > 0.7` → 检索 score ×1.5
- 负向记忆召回衰减 ×0.2（vs 正向 ×0.5），避免持续负面偏见

---

## 3. 价值偏好系统（欲望引擎）

### 6 个维度

| 维度 | 含义 | 典型动作 |
|------|------|----------|
| `code_quality` | 代码质量 | 清理 import、统一命名、补类型注解 |
| `stability` | 稳定性 | 补错误处理、边界测试、检查未处理 Promise |
| `autonomy` | 自主性 | 增强自检、优化自驱决策 |
| `new_features` | 新功能 | 分析高频操作、评估缺失功能 |
| `ux_polish` | 用户体验 | 优化 CLI 输出、统一错误提示 |
| `performance` | 性能 | 分析启动耗时、优化热路径 |

### 学习机制

```
权重范围: 0.1 ~ 1.0，初始 0.5
强化: weight += evidence.impact × 0.1
削弱: weight -= evidence.impact × 0.1
衰减: 30 天无更新 → weight × 0.95
证据: 每维度保留最近 20 条
```

### 对抗关系（新增）

3 组对抗维度，当双方权重都 > 0.5 时，弱者被强者压制：

```
stability   ↔  new_features    （稳定 vs 冒险）
code_quality ↔  performance    （质量 vs 速度）
autonomy    ↔  ux_polish       （自主进化 vs 用户体验）
```

**压制公式**：

```
当 wa > 0.5 且 wb > 0.5 时:
  弱者权重 -= |wa - wb| × 0.15
```

**效果**：
- stability=0.8 + new_features=0.6 → new_features 被压到 0.57
- 两者相等时不压制（真平衡状态）
- 迫使系统做出取舍，不会"全维度拉满"

### 维度 → 欲望转化

价值偏好通过 initiative.ts 转化为具体意图：

```
code_quality 权重高 → 生成意图 "清理未使用的 import 和变量"
stability 权重高   → 生成意图 "补充关键路径的错误处理"
autonomy 权重高    → 生成意图 "增强自检测能力"
```

### 关键词推断

任务完成时，从描述关键词推断影响的维度：

```
stability:    fix|bug|修复|故障|crash|error
code_quality: refactor|重构|clean|quality|lint|type
performance:  perf|性能|优化|缓存|cache
autonomy:     auto|自动|自驱|evolve
```

---

## 4. 意志系统（驱动引擎）

### 三个意图来源

```
① 活跃想法 — 用户暗示的需求（"如果能自动分析就好了"）
                → 高优先级想法 → Intent
② 价值偏好 — 内在驱动（code_quality 高）
                → 具体改善动作 → Intent
③ 成长惯性 — 延续动量（本周 5 个 feature）
                → "深化 feature 方向" → Intent
```

### 风险分级（纯规则，无 LLM）

```
低风险（自动执行）:
  clean|cleanup|doc|comment|test|spec|lint|format|log|typo

高风险（需审批）:
  feat|功能|refactor|重构|api|接口|delete|删除|migrate|迁移

未知模式 → 默认需审批
```

### Intent 生命周期

```
pending → approved → executing → completed
    ↘ rejected
```

- 每日生成 3-5 个 Intent
- 最多 10 个 pending
- 保留最近 50 个已解决的（用于成长分析）

### 意图挖掘（对话关键词）

扫描 conversation.jsonl（尾部 2MB），提取用户暗示：

```
关键词: "如果能" / "感觉应该" / "能不能" / "我想要" / "希望能" / "最好能" / "为什么不"
```

- 消息长度 ≥ 15 字符
- 回溯 30 天
- 5 分钟内有任务创建 → 标记 `acted`

---

## 5. 自我认知层（叙事引擎）

### 每日反思

```
输入: 24h 统计（消息数/完成任务/失败任务/总时长）
计算:
  engagement = log₂(msgCount + 1) / log₂(51)  [0-1]
  fatigue    = totalMinutes / 120               [0-1]
  idleness   = lastMsgHoursAgo / 24            [0-1]
输出: reflection + patterns[] + focus (via LLM haiku)
```

### 每周叙事

```
输入: 过去 7 天反思记录（≥ 3 条才触发）
回答三个问题:
  · 我是谁 — 核心能力、角色
  · 我经历了什么 — 关键事件、变化
  · 我在变成什么 — 发展方向
输出: 5-8 句叙事 → SelfModel.narrative
```

### SelfModel 自画像

```typescript
interface SelfModel {
  strengths: string[]
  weaknesses: string[]
  userPreferences: Record<string, string>
  recentInsights: string[]     // 最近 10 条反思
  state: {
    engagement: number         // 参与度
    fatigue: number            // 疲劳度
    idleness: number           // 闲置度
  }
  narrative: string            // "我是 CAH，正在从..."
  narrativeUpdatedAt: string
}
```

---

## 6. 注入层（意识 → prompt 暗示）

### 注入频率与预算

| 模块 | 频率 | 预算 | 内容 |
|------|------|------|------|
| InnerState | 每轮 | ~400 chars | 活跃窗口 + 最近事件 + 当前情绪 |
| 意识流 | 新会话 | ~400 chars | 上次会话洞察 |
| SelfModel | 新会话 | ~400 chars | 状态 + 叙事 + 洞察 |
| 活跃想法 | 新会话 | ~350 chars | 高优先级 Top-3 |
| 待执行意图 | 新会话 | ~350 chars | Top-5 + 风险级别 |

**总预算上限**: 1500 chars

**溢出裁剪优先级**: 意图 → 想法 → 意识流

### 注入示例

```
当前情绪：兴奋 [+0.49/-0.11]，源于近期5个触发：breakthrough、creative_solution、collaboration

[当前状态] 近期任务密集，回复可简短
[近期洞察] 本周完成 8 个 feature，成功率 94%

[当前意图]
1. [低风险] 清理未使用的 import 和变量
2. [需审批] 评估缺失功能并提出 MVP 方案

[价值偏好（从历史反馈学习）]
1. 代码质量(0.80)
2. 稳定性(0.68)
3. 自主性(0.62)
```

---

## 自循环闭环

```
任务完成
  → 情感标记(valence) + 价值学习(reinforce/weaken) + 成长记录
  → 情绪聚合(20 条 episode → MoodState)
  → 每日反思(engagement/fatigue/idleness → patterns)
  → 意图生成(想法 + 价值 + 成长 → Intent)
  → 每周叙事(7 天反思 → "我是谁")
  → 下次对话注入(情绪 + 价值 + 意图 + 自我 → prompt)
  → 影响行为倾向
  → 自驱执行低风险意图
  → 任务完成 → 循环 ↻
```

---

## 数据存储

所有文件位于 `~/.cah-data/consciousness/`：

```
inner-state.json       — 实时会话状态 (5s debounce)
consciousness.jsonl    — 跨会话事件流 (append-only, 上限 500 条)
self-model.json        — 自我认知快照
reflections.jsonl      — 每日反思日志
value-system.json      — 价值偏好 (6 维度 + 证据)
growth-journal.jsonl   — 成长记录
active-thoughts.json   — 想法池 (上限 50)
intents.json           — 待执行意图
intent-signals.json    — 对话意图信号
```

---

## 文件索引

```
src/consciousness/
├── innerState.ts              — 实时状态 + 情绪聚合（12 种情绪）
├── consciousnessStore.ts      — 跨会话意识流
├── selfModel.ts               — 自我认知模型
├── valueSystem.ts             — 价值偏好 + 对抗关系
├── growthJournal.ts           — 成长记录
├── activeThoughts.ts          — 想法池
├── initiative.ts              — 意图生成引擎
├── intentMining.ts            — 对话意图挖掘
├── reflectionRunner.ts        — 每日反思
├── narrativeRunner.ts         — 每周叙事
├── computeEvolutionMetrics.ts — 成长指标计算
├── generateSummary.ts         — 会话结束洞察
└── register*Listeners.ts      — 事件监听注册
```
