# CAH 数字生命记忆架构

> 融合人脑认知模型 + EverMemOS 精华，构建有温度、有遗忘、有成长的 AI 记忆系统。

## 设计原则

1. **单次 LLM 原则**：每次对话只允许一次 LLM 调用（即主对话回复），所有记忆检索和更新必须通过算法/RAG 完成
2. **排名竞争晋升**：记忆分层有容量上限，靠综合评分排名竞争位置，而非硬阈值
3. **情感加速固化**：高情感强度记忆衰减更慢、晋升更快（杏仁核效应）
4. **有遗忘才有记忆**：Ebbinghaus 衰减 + 容量淘汰，保持记忆质量

---

## 记忆分层（Memory Tiers）

三层存储，每层有容量上限（可配置）：

```
┌──────────────────────────────────────┐
│  永久层 tier=permanent               │
│  容量: maxPermanent (默认 100)       │
│  衰减: 无（只能被矛盾事实覆盖）      │
│  内容: 用户身份/核心偏好/重大决策     │
└──────────────────────────────────────┘
         ↑ 排名晋升 / ↓ 矛盾覆盖
┌──────────────────────────────────────┐
│  长期层 tier=longterm                │
│  容量: maxLongterm (默认 1000)       │
│  衰减: Ebbinghaus 慢衰减            │
│  内容: 语义记忆/情景记忆/MemScene    │
└──────────────────────────────────────┘
         ↑ 排名晋升 / ↓ 末位淘汰
┌──────────────────────────────────────┐
│  热点层 tier=hot                     │
│  容量: maxHot (默认 200)             │
│  衰减: 快衰减 (stability 24~72h)    │
│  内容: 原子事实/前瞻推断/近期记忆    │
└──────────────────────────────────────┘
```

### 晋升机制（排名竞争）

**不是** `accessCount > 5 就晋升`，而是 `层满时末位淘汰 + 高分记忆挤进来`。

评分公式：

```
score = accessFrequency × recency × importance × (1 + valence.intensity × 0.5)
```

- **情感加速通道**: `valence.intensity > 0.8` → `score × 2`
- **hot → longterm**: 候选条件 `age > 2h`，按 score 降序取 Top-K（K = longterm 空余名额）
- **longterm → permanent**: 候选条件 `accessCount ≥ 3`，按 score 降序取 Top-K（K = permanent 空余名额）
- **层满时**: 该层 score 最低的记忆降级到下一层（permanent → longterm），或归档（longterm → archive）

### 异步巩固（每小时）

模拟人脑睡眠巩固：

1. 计算各层记忆 score
2. 执行晋升/降级/淘汰
3. MemScene 增量聚类更新
4. 矛盾检测 → 旧的标记 `superseded=true`

---

## 记忆类型（Memory Types）

### 1. 语义记忆（Semantic Memory）— 已有

分类：`pattern` / `lesson` / `pitfall` / `preference` / `tool`

```typescript
interface MemoryEntry {
  id: string
  content: string
  category: MemoryCategory
  keywords: string[]
  confidence: number        // 0-1
  strength: number          // 0-100, Ebbinghaus decay
  importance: number        // 1-10
  tier: 'hot' | 'longterm' | 'permanent'  // ★新增
  accessCount: number
  associations: Association[]
  valence?: EmotionalValence
  // ...其他现有字段
}
```

### 2. 情景记忆（Episodic Memory）— 已有

```typescript
interface Episode {
  id: string
  timestamp: string
  summary: string
  keyDecisions: string[]
  triggerKeywords: string[]
  valence: EmotionalValence  // 情感标记
  relatedMemories: string[]
  // ...其他现有字段
}
```

### 3. 原子事实（Atomic Facts）— 新增，来自 EverMemOS

最小可验证的离散事实单元，粒度比语义记忆更细。

```typescript
interface AtomicFact {
  id: string
  fact: string              // "用户持有中银国有企业债A (001235)"
  confidence: number        // 0-1
  validUntil?: string       // ISO 时间，过期自动跳过
  domain: string            // "fund" / "health" / "work" / "code"
  source: 'chat' | 'task' | 'manual'
  createdAt: string
  accessCount: number
  tier: 'hot' | 'longterm' | 'permanent'
}
```

**提取方式**（纯算法，0 LLM）：
- regex 实体提取：API 路径、代码标识符、命令、基金代码
- 关键词模式匹配：`"持有/使用/偏好/地址" + 实体` → 提取为事实

### 4. MemScene 用户模型快照（新增，来自 EverMemOS）

按领域聚合记忆，形成"用户画像"。

```typescript
interface MemScene {
  domain: string            // "fund" / "health" / "work" / "code"
  summary: string           // 聚合摘要
  factIds: string[]         // 关联的 atomicFact IDs
  memoryIds: string[]       // 关联的 semantic memory IDs
  episodeIds: string[]      // 关联的 episode IDs
  updatedAt: string
}
```

**聚类方式**（纯算法）：
- 新记忆按 `domain` 标签归类
- domain 匹配规则：关键词词典（如 `基金/持仓/收益` → `fund`）
- 同 domain 内矛盾检测 → 旧事实标记 superseded

### 5. 前瞻推断（Foresight）— 新增，来自 EverMemOS

带时效的预测，过期自动消失。

```typescript
interface Foresight {
  id: string
  prediction: string        // "基金近期可能回调"
  validUntil: string        // ISO 时间
  domain: string
  confidence: number
  createdAt: string
}
```

---

## 对话时序流

### Phase 1: 海马体 · 纯算法检索（<50ms, 0 LLM）

```
用户消息
    │
    ├── 关键词提取（extractKeywords）
    ├── 实体提取（regex: API/代码/命令/基金码）
    ├── 时间解析（昨天/N天前/上周 → 时间范围）
    │
    ▼
5 路并行检索:

① 语义记忆
   keyword fuzzy + TF-IDF rerank + BFS 关联扩散
   tier 权重: permanent ×1.5 / longterm ×1.0 / hot ×0.7
   strength < 10 → 过滤
   最多 8 条

② 情景记忆
   timeRecency×0.3 + keywordMatch×0.4 + semanticLink×0.3
   情感加成: intensity>0.7 → score×1.5
   时间词触发 → 扩量
   2-3 条

③ 原子事实
   entity index 精准命中
   validUntil < now → 跳过
   confidence < 0.5 → 跳过
   Top-5

④ MemScene 快照
   消息关键词 → domain 匹配
   命中 1 个 domain 的聚合快照

⑤ 前瞻推断
   domain + 关键词交集
   有效期内 Top-2
```

### Phase 2: 工作记忆组装（Context Window）

按优先级组装进 prompt，总预算 ~3000 chars：

```
## 记忆上下文

[层1: MemScene 用户快照]        ~200 chars
  你了解的用户:
  · [fund] 持有5只基金，偏好低中风险

[层2: 原子事实]                 ~500 chars
  已知事实:
  · 持有 001235 中银国有企业债A

[层3: 情景记忆]                 ~600 chars
  [情景回忆: 2026-03-10 14:30]
  对话摘要: ...

[层4: 语义记忆]                 ~1500 chars
  ### 最佳实践
  - ...
  ### 偏好设置
  - ...

[层5: 前瞻推断]                 ~200 chars
  预测提示:
  · 基金近期可能回调（有效至 3/20）
```

### Phase 3: 唯一 LLM 调用

```
输入 = 用户消息 + 工作记忆（Phase 2 输出）
输出 = AI 回复
```

### Phase 4: 算法更新（0 LLM, <10ms）

```
① 规则提取 → hot 层
   regex 实体 → atomicFacts
   关键词模式 → semantic memory

② 情感估算（规则词典）
   负向词/感叹 → valence.negative
   成功词 → valence.positive
   强情感(>0.8) → stability ×2

③ 访问强化
   被召回记忆 reinforceCount++
   重置衰减时钟

④ 衰减 tick
   hot: 快衰减
   longterm: 慢衰减
   permanent: 跳过
```

---

## 人脑映射

| 脑区 | CAH 组件 | 职责 |
|------|----------|------|
| 海马体 | RAG 检索 + entity index + 关联网络 | 记忆检索与索引 |
| 前额皮质 | Context Window 组装 | 工作记忆整合 |
| 新皮质 | LLM（唯一调用） | 推理与回复生成 |
| 杏仁核 | 情感规则引擎 | 情感估算与固化加速 |
| 基底核 | 实体/关键词提取 | 程序性记忆更新 |
| 睡眠巩固 | 异步 consolidation（每小时） | 分层晋升与淘汰 |

---

## 配置项

```yaml
# ~/.claude-agent-hub.yaml
memory:
  tiers:
    maxPermanent: 100     # 永久层容量
    maxLongterm: 1000     # 长期层容量
    maxHot: 200           # 热点层容量
  consolidation:
    intervalMs: 3600000   # 巩固周期（默认 1 小时）
  forgetting:
    archiveThreshold: 20  # strength% 归档阈值
    deleteThreshold: 5    # strength% 删除阈值
  atomicFacts:
    maxPerConversation: 10  # 每次对话最多提取事实数
  memScene:
    domains:              # 预定义领域词典
      fund: [基金, 持仓, 收益, 净值, 基金代码]
      health: [体态, 健康, 运动, 疼痛, 拉伸]
      work: [flex, flow360, jira, PR, deploy]
      code: [bug, 重构, 架构, 测试, 性能]
```

---

## 与 EverMemOS 对比

### 取其精华
- **Atomic Facts**: 最小事实单元，精准检索
- **MemScene**: 主题聚类，构建用户模型
- **Foresight**: 前瞻推断，带时效

### 去其糟粕
- EverMemOS 无情感层 → CAH 保留 valence + 杏仁核效应
- EverMemOS 无意识系统 → CAH 保留 InnerState / ValueSystem / GrowthJournal
- EverMemOS 是独立服务 → CAH 深度集成到 agent 生命周期
- EverMemOS 无遗忘曲线 → CAH 保留 Ebbinghaus decay + 排名竞争

### CAH 独有
- 情感加速固化（高 valence → 快晋升）
- 意识流 + 自我模型（数字生命方向）
- 任务执行学习（从 task 结果提取记忆）
- 关联网络 BFS 扩散

---

## 实施路线

### Phase 1: 基础设施
- `types.ts` 新增 `tier` 字段、`AtomicFact`、`Foresight`、`MemScene` 类型
- `forgettingEngine.ts` 支持 tier 分层衰减（permanent 跳过）
- 配置 schema 新增 tiers 配置项

### Phase 2: 原子事实
- 新增 `extractAtomicFacts.ts`（纯规则，regex + 模式匹配）
- 新增 `AtomicFactStore.ts`
- `retrieveMemory.ts` 集成原子事实检索路径

### Phase 3: MemScene 用户模型
- 新增 `memScene.ts`（domain 关键词聚类 + 快照生成）
- `formatMemory.ts` 集成 MemScene 注入

### Phase 4: 排名竞争晋升
- 新增 `tierPromotion.ts`（评分 + 晋升/降级/淘汰）
- 异步巩固定时器集成到 daemon

### Phase 5: 前瞻推断（可选）
- 新增 `foresight.ts`
- 检索时过滤过期推断

### Phase 6: 去 LLM 化
- `extractChatMemory.ts` 改为规则提取
- `expandQuery.ts` 改为同义词词典
- `consolidateMemories.ts` 改为算法合并（Jaccard > 0.7）
