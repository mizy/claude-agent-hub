# 类人记忆系统：遗忘 + 联想机制

> 让 AI Agent 的记忆像人一样：重要的越记越牢，无用的自然遗忘，相关的自动联想。

## 1. 现有系统分析

### 当前数据模型

```typescript
interface MemoryEntry {
  id: string
  content: string
  category: MemoryCategory  // 'pattern' | 'lesson' | 'preference' | 'pitfall' | 'tool'
  keywords: string[]
  source: MemorySource       // { type: 'task' | 'manual' | 'chat', taskId? }
  confidence: number         // 0-1
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string
  accessCount: number
  projectPath?: string
}
```

### 当前检索评分

```
score = keywordOverlap * 2 + projectBonus * 0.3 + confidence * 0.5
      + 1/(1 + ageDays/30) + log(1 + accessCount) * 0.2
```

### 主要不足

1. **无遗忘机制**：记忆只增不减，长期积累后检索质量下降（噪音增加）
2. **无联想能力**：检索仅靠关键词匹配，不能从已知推到相关
3. **无记忆强化**：被多次验证的重要记忆与普通记忆没有区别
4. **时间衰减粗糙**：`1/(1+days/30)` 只是检索排序因子，不影响记忆本身

---

## 2. 理论基础

### 2.1 艾宾浩斯遗忘曲线

**核心公式**：`R = e^(-t/S)`

- `R`：记忆保留率 (0-1)
- `t`：距上次复习的时间（小时）
- `S`：记忆稳定性（越大衰减越慢）

**关键参数**：
- 新记忆初始 S ≈ 24h（1天后保留率约 37%）
- 每次成功回忆，S 增大（记忆变稳定）
- 失败回忆，S 不变或缩小

### 2.2 SM-2 间隔重复算法

**最优复习间隔**：
- 第 1 次复习：1 天后
- 第 2 次复习：6 天后
- 第 n 次复习：`interval(n-1) × EF`

**简易因子（EF）**：
- 初始 EF = 2.5
- 回忆质量 q (0-5) 影响 EF 调整
- `EF' = EF + (0.1 - (5-q) × (0.08 + (5-q) × 0.02))`
- EF 最低 1.3

**本系统适配**：任务成功 = q=5（完美回忆），任务失败引用该记忆 = q=2（困难回忆），记忆未被使用 = 自然遗忘。

### 2.3 语义网络与激活扩散

**核心思想**：
- 记忆以节点形式存在于网络中
- 节点间通过语义关系连接（边有权重）
- 激活一个节点时，激活沿边向邻居扩散
- 扩散强度按距离衰减：`activation(n) = activation(source) × edgeWeight × decayFactor`

**本系统适配**：
- 节点 = MemoryEntry
- 边 = 关键词重叠 / 同任务产生 / 同项目
- 检索时：先找到匹配节点，再沿边扩散找到相关节点

### 2.4 短期→长期记忆转换

**巩固条件**：
- 重复访问（间隔重复比集中重复更有效）
- 情感强度（对应：任务成功/失败的影响比普通访问更大）
- 与已有知识的关联（有更多关联的记忆更容易巩固）

---

## 3. 数据模型扩展

### 3.1 扩展 MemoryEntry

```typescript
interface MemoryEntry {
  // === 现有字段（保持不变）===
  id: string
  content: string
  category: MemoryCategory
  keywords: string[]
  source: MemorySource
  confidence: number          // 0-1，AI提取时的置信度
  createdAt: string
  updatedAt: string
  lastAccessedAt?: string
  accessCount: number
  projectPath?: string

  // === 新增：遗忘引擎字段 ===
  strength: number            // 0-100，记忆强度（替代之前的检索时计算）
  stability: number           // 记忆稳定性 S（小时），控制衰减速度
  lastReinforcedAt: string    // 上次强化时间（强化 ≠ 访问，是有意义的使用）
  reinforceCount: number      // 强化次数（不同于 accessCount）
  decayRate: number           // 衰减速率因子（0.5-2.0，越大衰减越快）

  // === 新增：联想引擎字段 ===
  associations: Association[] // 与其他记忆的关联
}

interface Association {
  targetId: string            // 关联目标记忆 ID
  weight: number              // 关联强度 0-1
  type: AssociationType       // 关联类型
}

type AssociationType =
  | 'keyword'                 // 关键词重叠
  | 'co-task'                 // 同一任务产生
  | 'co-project'              // 同一项目
  | 'semantic'                // 语义相近（AI判断）
```

### 3.2 MemorySource 扩展

```typescript
interface MemorySource {
  type: 'task' | 'manual' | 'chat'
  taskId?: string
  // === 新增 ===
  chatId?: string             // 对话来源 ID
  messageId?: string          // 消息 ID
}
```

### 3.3 向后兼容迁移

旧数据加载时自动填充默认值：

```typescript
function migrateMemoryEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    strength: entry.strength ?? 50,
    stability: entry.stability ?? computeInitialStability(entry),
    lastReinforcedAt: entry.lastReinforcedAt ?? entry.updatedAt ?? entry.createdAt,
    reinforceCount: entry.reinforceCount ?? entry.accessCount ?? 0,
    decayRate: entry.decayRate ?? 1.0,
    associations: entry.associations ?? [],
  }
}

// 老记忆根据 accessCount 和 confidence 推算初始稳定性
function computeInitialStability(entry: MemoryEntry): number {
  const base = 24 // 基础 24 小时
  const accessBonus = Math.min(entry.accessCount * 12, 120) // 每次访问 +12h，上限 120h
  const confidenceBonus = entry.confidence * 48 // 高置信度 +48h
  return base + accessBonus + confidenceBonus
}
```

迁移策略：**懒加载迁移** — 读取时检测并补充缺失字段，写回时保存完整结构。不做批量迁移。

---

## 4. 遗忘引擎设计

### 4.1 强度计算

**核心公式**（基于艾宾浩斯遗忘曲线）：

```typescript
function computeStrength(entry: MemoryEntry, now: Date): number {
  const hoursSinceReinforce = (now - entry.lastReinforcedAt) / 3600000
  const retention = Math.exp(-hoursSinceReinforce / entry.stability)
  return Math.round(retention * 100) // 0-100
}
```

### 4.2 稳定性更新（简化 SM-2）

每次记忆被**有意义地使用**（不是简单检索，而是在任务中被引用或验证），更新稳定性：

```typescript
function reinforceMemory(entry: MemoryEntry, event: ReinforceEvent): void {
  const multiplier = REINFORCE_MULTIPLIERS[event] // 见下表
  entry.stability = Math.min(entry.stability * multiplier, MAX_STABILITY)
  entry.reinforceCount += 1
  entry.lastReinforcedAt = new Date().toISOString()
  // 强化后 strength 重新从 100 开始衰减
}
```

**强化事件及倍数**：

| 事件 | stability 倍数 | 说明 |
|------|---------------|------|
| `retrieve` | 1.2 | 被检索命中（轻度强化） |
| `task-success` | 2.0 | 在成功任务中被引用 |
| `task-failure` | 0.8 | 在失败任务中被引用（减弱） |
| `manual-review` | 1.5 | 用户手动确认/查看 |
| `association-hit` | 1.1 | 通过联想被间接激活 |

**参数范围**：
- `MAX_STABILITY = 8760`（365天，一年后基本永久记忆）
- 初始 stability = 24h（新记忆）
- 手动添加的记忆初始 stability = 168h（7天，用户主动记录更重要）

### 4.3 衰减速率分级

`decayRate` 影响实际衰减速度：`effectiveStability = stability / decayRate`

```typescript
function computeDecayRate(entry: MemoryEntry): number {
  // 高置信度 + 多次强化 → 衰减更慢
  let rate = 1.0
  if (entry.confidence >= 0.8) rate *= 0.7     // 高置信度，衰减慢 30%
  if (entry.reinforceCount >= 5) rate *= 0.8   // 多次强化，衰减慢 20%
  if (entry.category === 'pitfall') rate *= 0.9 // 教训类衰减更慢
  return Math.max(rate, 0.5) // 最低 0.5（不能完全不衰减）
}
```

### 4.4 清理策略

**定期清理**（每次 `cah` CLI 调用时检查，类似 orphan detection）：

```typescript
function cleanupWeakMemories(): { archived: string[], deleted: string[] } {
  const entries = getAllMemories()
  const now = new Date()
  const archived: string[] = []
  const deleted: string[] = []

  for (const entry of entries) {
    const strength = computeStrength(entry, now)

    if (strength < 5) {
      deleteMemory(entry.id)
      deleted.push(entry.id)
    } else if (strength < 10) {
      // 归档：移到 archive 子目录，不再参与检索
      archiveMemory(entry)
      archived.push(entry.id)
    }
  }

  return { archived, deleted }
}
```

**清理频率控制**：使用 `lastCleanupAt` 文件记录上次清理时间，间隔 > 1 小时才执行。

### 4.5 可配置参数

```yaml
# config.yaml 中新增
memory:
  decay:
    initialStability: 24          # 新记忆初始稳定性（小时）
    manualStability: 168          # 手动记忆初始稳定性（小时）
    maxStability: 8760            # 最大稳定性（小时）
    archiveThreshold: 10          # strength < 10 归档
    deleteThreshold: 5            # strength < 5 删除
    cleanupIntervalHours: 1       # 清理检查间隔
  reinforce:
    retrieve: 1.2
    taskSuccess: 2.0
    taskFailure: 0.8
    manualReview: 1.5
    associationHit: 1.1
```

---

## 5. 联想引擎设计

### 5.1 关联建立

**时机**：新记忆创建时 + 定期更新

#### 5.1.1 关键词重叠关联

```typescript
function buildKeywordAssociations(newEntry: MemoryEntry, allEntries: MemoryEntry[]): Association[] {
  const associations: Association[] = []
  for (const existing of allEntries) {
    if (existing.id === newEntry.id) continue
    const overlap = computeKeywordOverlap(newEntry.keywords, existing.keywords)
    if (overlap >= 0.3) { // 重叠率阈值
      associations.push({
        targetId: existing.id,
        weight: overlap,
        type: 'keyword',
      })
    }
  }
  return associations
}

function computeKeywordOverlap(a: string[], b: string[]): number {
  const setA = new Set(a)
  const intersection = b.filter(k => setA.has(k)).length
  const union = new Set([...a, ...b]).size
  return union > 0 ? intersection / union : 0 // Jaccard 系数
}
```

#### 5.1.2 共现关联

同一个任务产生的多条记忆自动互相关联：

```typescript
function buildCoTaskAssociations(newEntry: MemoryEntry, allEntries: MemoryEntry[]): Association[] {
  if (newEntry.source.type !== 'task' || !newEntry.source.taskId) return []
  return allEntries
    .filter(e => e.id !== newEntry.id && e.source.taskId === newEntry.source.taskId)
    .map(e => ({ targetId: e.id, weight: 0.5, type: 'co-task' as const }))
}
```

#### 5.1.3 同项目关联

```typescript
function buildProjectAssociations(newEntry: MemoryEntry, allEntries: MemoryEntry[]): Association[] {
  if (!newEntry.projectPath) return []
  return allEntries
    .filter(e => e.id !== newEntry.id && e.projectPath === newEntry.projectPath)
    .map(e => ({ targetId: e.id, weight: 0.2, type: 'co-project' as const }))
}
```

### 5.2 关联合并

同一对记忆可能有多种关联类型，取最强的：

```typescript
function mergeAssociations(associations: Association[]): Association[] {
  const byTarget = new Map<string, Association>()
  for (const a of associations) {
    const existing = byTarget.get(a.targetId)
    if (!existing || a.weight > existing.weight) {
      byTarget.set(a.targetId, a)
    }
  }
  return [...byTarget.values()]
}
```

### 5.3 激活扩散算法

**检索增强**：找到直接匹配后，沿关联链路扩散找到间接相关记忆。

```typescript
interface ActivatedMemory {
  entry: MemoryEntry
  activation: number    // 激活强度
  depth: number         // 扩散深度
  path: string[]        // 激活路径（用于解释）
}

function spreadActivation(
  seeds: ActivatedMemory[],           // 直接检索命中的记忆
  allEntries: Map<string, MemoryEntry>,
  options: { maxDepth?: number, minActivation?: number, maxResults?: number }
): ActivatedMemory[] {
  const { maxDepth = 2, minActivation = 0.1, maxResults = 5 } = options
  const activated = new Map<string, ActivatedMemory>()

  // 种子节点
  for (const seed of seeds) {
    activated.set(seed.entry.id, seed)
  }

  // BFS 扩散
  let frontier = [...seeds]
  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: ActivatedMemory[] = []
    for (const current of frontier) {
      for (const assoc of current.entry.associations) {
        if (activated.has(assoc.targetId)) continue // 已激活，跳过
        const target = allEntries.get(assoc.targetId)
        if (!target) continue

        const propagatedActivation = current.activation * assoc.weight * 0.7 // 距离衰减 30%
        if (propagatedActivation < minActivation) continue

        const node: ActivatedMemory = {
          entry: target,
          activation: propagatedActivation,
          depth,
          path: [...current.path, current.entry.id],
        }
        activated.set(assoc.targetId, node)
        nextFrontier.push(node)
      }
    }
    frontier = nextFrontier
  }

  // 返回非种子节点，按激活强度排序
  return [...activated.values()]
    .filter(a => !seeds.some(s => s.entry.id === a.entry.id))
    .sort((a, b) => b.activation - a.activation)
    .slice(0, maxResults)
}
```

### 5.4 关联强度更新

```typescript
function updateAssociationWeight(entry: MemoryEntry, targetId: string, boost: number): void {
  const assoc = entry.associations.find(a => a.targetId === targetId)
  if (assoc) {
    assoc.weight = Math.min(assoc.weight + boost, 1.0)
  }
}
```

**更新时机**：
- 两条记忆在同一次检索中同时命中：双方关联 +0.05
- 联想命中的记忆被用户确认有用：关联 +0.1

---

## 6. 检索流程（新）

整合遗忘 + 联想后的检索流程：

```typescript
function retrieveRelevantMemories(query: string, options?: RetrieveOptions): MemoryEntry[] {
  const now = new Date()
  const allEntries = getAllMemories().map(migrateMemoryEntry)

  // 1. 计算实时强度，过滤已遗忘的
  const activeEntries = allEntries.filter(e => computeStrength(e, now) >= 10)

  // 2. 关键词匹配 + 评分（现有逻辑，用 strength 替代旧的时间衰减）
  const queryKeywords = extractKeywords(query)
  const scored = activeEntries.map(entry => ({
    entry,
    score: computeRelevanceScore(entry, queryKeywords, options, now),
  }))

  // 3. 取 top-N 作为种子
  const seeds = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => ({
      entry: s.entry,
      activation: s.score,
      depth: 0,
      path: [] as string[],
    }))

  // 4. 激活扩散：联想相关记忆
  const entryMap = new Map(activeEntries.map(e => [e.id, e]))
  const associated = spreadActivation(seeds, entryMap, {
    maxDepth: 2,
    minActivation: 0.1,
    maxResults: 5,
  })

  // 5. 合并结果（直接命中 + 联想命中）
  const results = [
    ...seeds.map(s => s.entry),
    ...associated.map(a => a.entry),
  ]

  // 6. 更新访问统计 + 轻度强化
  for (const entry of results) {
    reinforceMemory(entry, 'retrieve')
    entry.accessCount += 1
    entry.lastAccessedAt = now.toISOString()
    saveMemory(entry)
  }

  return results.slice(0, options?.maxResults ?? 10)
}

function computeRelevanceScore(
  entry: MemoryEntry, queryKeywords: string[],
  options: RetrieveOptions | undefined, now: Date
): number {
  const keywordOverlap = computeKeywordOverlapScore(entry.keywords, queryKeywords)
  const strength = computeStrength(entry, now) / 100 // 归一化到 0-1
  const projectBonus = (options?.projectPath && entry.projectPath === options.projectPath) ? 0.3 : 0
  const confidenceBonus = entry.confidence * 0.3

  return keywordOverlap * 2 + strength * 0.5 + projectBonus + confidenceBonus
}
```

---

## 7. 多源记忆：Chat 记忆

### 7.1 数据模型

Chat 记忆复用 MemoryEntry，通过 `source.type = 'chat'` 区分：

```typescript
const chatMemory: MemoryEntry = {
  // ...common fields
  source: {
    type: 'chat',
    chatId: 'lark-chat-xxx',    // 飞书/Telegram 会话 ID
    messageId: 'msg-yyy',       // 触发消息 ID
  },
}
```

### 7.2 提取判断标准

从对话中提取记忆的条件（由 AI 判断）：

1. **用户明确要求记住**：「记住这个」「以后注意」「下次别忘了」
2. **重要决策**：技术选型、架构决定、项目约定
3. **反复出现的问题**：用户多次问同一类问题
4. **纠错信息**：用户纠正了 AI 的错误回答

**不提取**：
- 闲聊内容
- 一次性查询（「今天天气」）
- 已存在的重复记忆

### 7.3 提取时机

在 messaging handler 中，对话结束或用户明确指示时触发提取。

---

## 8. 模块清单

### 8.1 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/memory/types.ts` | 新增 strength, stability, associations 等字段 |
| `src/memory/manageMemory.ts` | addMemory 时建立关联、设置初始 stability |
| `src/memory/retrieveMemory.ts` | 集成遗忘引擎过滤 + 联想扩散 |
| `src/memory/extractMemory.ts` | 提取后建立 co-task 关联 |
| `src/memory/formatMemory.ts` | 格式化时展示关联信息（可选） |
| `src/memory/index.ts` | 导出新函数 |
| `src/cli/commands/memory.ts` | 新增 strength 显示、清理命令 |

### 8.2 需要新建的文件

| 文件 | 职责 |
|------|------|
| `src/memory/decayMemory.ts` | 遗忘引擎：强度计算、稳定性更新、衰减速率 |
| `src/memory/reinforceMemory.ts` | 强化逻辑：不同事件的强化处理 |
| `src/memory/associateMemory.ts` | 联想引擎：关联建立、合并、更新 |
| `src/memory/spreadActivation.ts` | 激活扩散算法 |
| `src/memory/cleanupMemory.ts` | 清理策略：归档、删除弱记忆 |
| `src/memory/migrateMemory.ts` | 向后兼容：懒加载迁移逻辑 |
| `src/memory/extractChatMemory.ts` | Chat 记忆提取 |

### 8.3 测试文件

| 文件 | 测试内容 |
|------|----------|
| `src/memory/__tests__/decayMemory.test.ts` | 强度计算、衰减曲线验证 |
| `src/memory/__tests__/associateMemory.test.ts` | 关联建立、合并逻辑 |
| `src/memory/__tests__/spreadActivation.test.ts` | 激活扩散正确性 |
| `src/memory/__tests__/cleanupMemory.test.ts` | 清理阈值、归档逻辑 |
| `src/memory/__tests__/migrateMemory.test.ts` | 迁移兼容性 |

---

## 9. 实现优先级

### Phase 1：遗忘引擎（核心）
1. 数据模型扩展 + 迁移
2. 强度计算 (`decayMemory.ts`)
3. 强化逻辑 (`reinforceMemory.ts`)
4. 清理策略 (`cleanupMemory.ts`)
5. 检索集成（用 strength 替代旧的时间衰减）

### Phase 2：联想引擎
6. 关联建立 (`associateMemory.ts`)
7. 激活扩散 (`spreadActivation.ts`)
8. 检索集成（联想扩展结果）

### Phase 3：多源记忆
9. Chat 记忆提取 (`extractChatMemory.ts`)
10. Messaging 层集成

---

## 10. 设计决策摘要

| 决策 | 选择 | 理由 |
|------|------|------|
| 遗忘模型 | 艾宾浩斯 `e^(-t/S)` | 简单、有理论支撑、参数少 |
| 强化模型 | 简化 SM-2 | 全套 SM-2 需要用户评分，简化为事件驱动 |
| 联想算法 | BFS 激活扩散 | 实现简单，深度可控，效果够用 |
| 关联建立 | Jaccard 关键词重叠 | 不依赖外部服务，计算快 |
| 迁移策略 | 懒加载 | 零停机，无批量迁移风险 |
| 清理策略 | 归档+删除两级 | 避免误删，归档可恢复 |
| strength 范围 | 0-100 整数 | 直观易理解，便于显示和阈值判断 |

---

## 11. 实现注意事项

### 11.1 实际文件结构（vs 设计）

实现时将多个模块合并为更简洁的文件结构：

| 设计中的文件 | 实际实现 | 原因 |
|-------------|----------|------|
| `decayMemory.ts` + `reinforceMemory.ts` + `cleanupMemory.ts` | `forgettingEngine.ts` | 功能内聚，合并减少文件碎片 |
| `associateMemory.ts` + `spreadActivation.ts` | `associationEngine.ts` | 关联建立与扩散紧密关联 |

### 11.2 关键实现细节

- **reinforceMemory 必须持久化 strength**：`reinforceMemory()` 在 `updateMemory()` 时必须同时写入 `strength` 字段，否则下次读取时 `migrateMemoryEntry()` 会因 `strength === undefined` 触发全量迁移，导致 `reinforceCount` 被重置为 0。
- **激活扩散衰减因子**：设计文档中使用 0.7（衰减 30%），实现中使用 0.5（衰减 50%）更保守，避免联想过度扩散。
- **时间邻近关联**：实现中使用 `buildTemporalAssociations` 替代 `co-project` 关联（24h 内创建的记忆自动关联），更实用。
- **associativeRetrieve 评分公式**：`(keywordScore * 0.6 + activationLevel * 0.4) * strength/100`，关键词匹配权重高于联想。

### 11.3 配置键名映射

| 配置 YAML 键 | reinforce 事件 |
|-------------|---------------|
| `retrieve` | `access` |
| `taskSuccess` | `task_success` |
| `taskFailure` | `task_failure` |
| `manualReview` | `manual` |

### 11.4 测试覆盖

| 测试文件 | 覆盖内容 |
|----------|----------|
| `forgettingEngine.test.ts` | 强度计算（精确数学验证）、强化倍数（access/task_success/task_failure/manual）、decayRate 动态调整（confidence/reinforceCount/pitfall/最小值0.5）、清理阈值（归档vs删除）、健康状态报告 |
| `associationEngine.test.ts` | Jaccard 关键词关联（含阈值边界）、时间邻近关联（24h内/超过）、共任务关联、关联合并去重、激活扩散（单跳/多跳/环路/深度限制/弱激活过滤/排序）、双向关联强度更新（含创建/增强/上限）、混合检索、批量重建 |
| `memoryLifecycle.test.ts` | 完整生命周期（创建→检索强化→关联建立→时间流逝→衰减→清理）、强化减缓衰减验证、向后兼容（旧格式自动迁移、已迁移条目零分配快速路径） |
| `memorySimulation.test.ts` | 20条记忆遗忘曲线（高频vs低频30天后对比）、强度单调递减验证、联想网络构建与激活扩散（含不相关记忆排除）、激活值距离衰减验证 |
| `retrieveMemory.test.ts` | 关键词匹配排序、项目路径加分、置信度排序、strength 时间衰减、访问计数累增、maxResults 限制、lastAccessedAt 与 updatedAt 分离 |

### 11.5 API 导出清单

`src/memory/index.ts` 按能力分组导出：

| 分组 | 导出 |
|------|------|
| Types | `MemoryCategory`, `MemoryEntry`, `MemorySource`, `Association`, `AssociationType`, `ChatMessage` |
| Management | `addMemory`, `listMemories`, `removeMemory`, `searchMemories` |
| Retrieval | `retrieveRelevantMemories` |
| Formatting | `formatMemoriesForPrompt` |
| Extraction | `extractMemoryFromTask`, `extractChatMemory` |
| Migration | `migrateMemoryEntry`, `needsMigration` |
| Forgetting | `calculateStrength`, `reinforceMemory`, `cleanupFadingMemories`, `getMemoryHealth` |
| Association | `buildAssociations`, `spreadActivation`, `updateAssociationStrength`, `associativeRetrieve`, `rebuildAllAssociations` |

### 11.6 CLI 命令

| 命令 | 功能 |
|------|------|
| `cah memory health` | 按强度排序显示所有记忆（绿/黄/红颜色区分） |
| `cah memory fading` | 显示 strength < 30 的衰减中记忆 |
| `cah memory reinforce <id>` | 手动强化指定记忆，显示前后强度变化 |
| `cah memory associations <id>` | 树形展示记忆关联关系 |
| `cah memory cleanup [--dry-run]` | 归档/删除弱记忆，支持干运行预览 |
