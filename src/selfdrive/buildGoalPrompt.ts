import type { SignalEvent } from '../selfevolve/signalDetector.js'
import { DATA_DIR } from '../store/paths.js'
import { getTopValues, formatValuePreferences } from '../consciousness/valueSystem.js'

const GOAL_PROMPTS: Record<string, string> = {
  'evolve': `执行一轮全局自进化周期：系统中的任何模块都可能成为改进对象。

分析范围（三个维度，选最有价值的方向）：

**1. 系统质量**
- 查看最近运行过的所有任务（成功和失败），从执行日志、耗时、节点输出中提取信号
- 审查各模块运行效果：workflow 引擎、memory 检索、scheduling 策略、错误处理等
- 识别重复出现的摩擦点、低效模式

**2. 对话与交互体验**
- 扫描最近任务的 conversation.jsonl / conversation.log，关注 AI 回复质量
- 检查回复是否冗长、偏题、格式不佳（如飞书 markdown 兼容性）
- 分析用户追问模式（连续追问暗示首次回答不满意）
- 检查各 agent 提示词的实际效果

**3. 功能缺口**
- 识别用户频繁手动重复的操作，评估自动化价值
- 检查高频需求模式，发现系统缺少的能力
- 优先选择可在单个 workflow 内完成的小型增强

改进目标可以是：
- 提示词优化（agent、workflow 生成、记忆提取、chat 回复格式等）
- 代码逻辑改进（错误处理、性能、健壮性）
- 配置调整（调度频率、阈值、超时等）
- 新能力补全

重要约束：
- 每轮只选择 2-3 个最高价值的改进，不要贪多
- 每项改进必须能在单个 workflow 节点内完成；若需要多步，应拆成多个独立 cah 任务分别提交
- 只实施低风险改进，排除涉及数据结构变更或核心引擎流程的修改
- 改进后必须运行 typecheck 验证，确保不引入回归
- 工作流必须简单：推荐 3 个节点（start → analyze-and-implement → end），最多 4 个节点（加一个 verify）
- 不要使用 review-fix 循环模式 — 自进化任务本身就是自检，不需要额外的审查循环
- 不要使用条件边 — 每个节点只有一个无条件出边，线性执行即可
- **严禁执行 cah restart、cah stop、kill 等任何终止/重启 daemon 的命令** — 会直接杀死当前运行的 daemon，stale_daemon 检测机制会在安全时机自动完成重启

生成改进方案并应用，记录进化历史。`,
  'evolve-feature': `执行一轮外部灵感采集，从开源社区和竞品中发现对 CAH 有价值的功能灵感。

## 步骤

**1. 爬取外部信息源**（使用 WebFetch/WebSearch 工具）

a) GitHub Trending：搜索 AI agent、task automation、LLM tools 相关仓库，关注 star 增长快的新项目
b) Hacker News (news.ycombinator.com)：搜索最近 AI agent、autonomous、agentic 相关帖子
c) 竞品 GitHub releases：
   - aider (paul-gauthier/aider)
   - goose (block/goose)
   - continue (continuedev/continue)

**2. 筛选灵感**

从采集内容中筛选「对 CAH 有价值的灵感」，每条灵感包含以下字段：
- source: 来源 URL
- title: 灵感标题
- idea: 核心思路（1-2句）
- inspiration: 对 CAH 的启发（具体到模块/功能）
- difficulty: 实施难度（low/medium/high）
- discoveredAt: ISO 时间戳
- status: 'pending'

**3. 持久化**

读取 ${DATA_DIR}/evolution/proposals.json（如不存在则初始化为空数组），追加新灵感。
保留最近 50 条（按 discoveredAt 倒序，截断旧的），写回文件。

**4. 输出报告**

输出本次发现的灵感列表摘要，格式为 markdown：
- 标题：外部灵感采集报告
- 每条灵感列出：标题、来源、启发方向、难度
- 末尾附指引：「回复 cah "实现 xxx" 即可创建执行任务」

## 约束
- 每轮采集 3-8 条高质量灵感，不要贪多
- 跳过已在 proposals.json 中存在的相同 source URL 的灵感（去重）
- 优先选择对 CAH 当前架构可落地的灵感，排除需要大规模重构的想法
- **严禁执行 cah restart、cah stop、kill 等命令**`,
  'cleanup-code': `执行一轮代码和文档清理，移除项目中的无用内容。

扫描范围：
- 查找空文件、无内容的占位文件
- 检查已废弃但未删除的代码文件（如标记了 deprecated 但仍存在的模块）
- 识别未使用的导出函数/类型（通过 grep 确认无其他文件引用）
- 查找过时的文档（README 中描述已不存在的功能、注释中引用已删除的文件）
- 检查 dead code 路径（永远不会到达的分支、注释掉的代码块）

清理原则：
- 只删除确认无用的内容，有疑问的保留
- 删除前通过 grep 确认无引用
- 每轮最多清理 3-5 个文件/函数，不要大规模删除
- 清理后运行 typecheck 和 test 验证无回归
- 记录清理内容到 git commit message
- **严禁执行 cah restart、cah stop、kill 等命令** — 会直接杀死 daemon`,
  'update-docs': `检查并更新项目文档，确保文档与代码实际状态一致。

检查范围：
- CLAUDE.md：命令列表、架构描述、@entry 模块索引是否与代码匹配
- 各模块入口文件的 JSDoc 注释是否准确描述了当前 API
- CLI --help 输出与实际命令是否一致
- 数据结构文档与实际 JSON schema 是否匹配
- ~/.claude/skills/cah/SKILL.md：检查 skill 触发描述、核心命令列表、workflow 说明是否与当前 cah CLI 实际行为匹配（重点：新增/删除的子命令、changed options、workflow 节点类型变化）
- 项目目录下的 SKILL.md（若存在）：同上，确保与 ~/.claude/skills/cah/SKILL.md 内容保持同步，两者的命令列表和触发条件应一致

更新原则：
- 只更新事实性内容（命令名、文件路径、API 签名等），不修改风格或措辞
- 新增的功能/命令补充文档说明
- 已删除的功能/命令移除文档中的引用
- 每轮最多更新 2-3 个文档文件
- 更新后通过 typecheck 验证（如果改了代码注释中的类型引用）`,
}

export function getGoalPrompt(goalType: string): string | undefined {
  const base = GOAL_PROMPTS[goalType]
  if (!base) return undefined

  // Inject value preferences for evolve-type goals
  if (goalType === 'evolve' || goalType === 'evolve-feature') {
    try {
      const topValues = getTopValues(3)
      const valueSection = formatValuePreferences(topValues)
      if (valueSection) {
        return `${valueSection}\n\n${base}`
      }
    } catch {
      // Value system not available, return base prompt
    }
  }
  return base
}

export function buildSignalEvolutionPrompt(signal: SignalEvent): string {
  return `执行一轮针对性自进化，聚焦于检测到的异常信号。

## 触发信号
- 类型: ${signal.type}
- 严重程度: ${signal.severity}
- 出现次数: ${signal.count}
- 模式: ${signal.pattern}
- 相关任务: ${signal.taskIds.join(', ')}

## 要求
1. 只分析上述相关任务的失败模式，不做全局扫描
2. 定位根因并生成针对性改进方案（1-2 个即可）
3. 只实施低风险改进，排除涉及数据结构变更的修改
4. 改进后运行 typecheck 验证
5. 记录进化历史，标明触发来源为信号检测`
}
