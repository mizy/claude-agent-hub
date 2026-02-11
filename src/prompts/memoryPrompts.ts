/**
 * Memory extraction prompt templates
 *
 * Used to extract reusable lessons from completed task executions.
 */

interface TaskSummary {
  title: string
  description: string
  nodes: Array<{ name: string; status: string; error?: string }>
  totalDurationMs: number
  finalStatus: string
}

export function buildMemoryExtractionPrompt(summary: TaskSummary): string {
  const nodeLines = summary.nodes
    .map(n => `- ${n.name}: ${n.status}${n.error ? ` (error: ${n.error})` : ''}`)
    .join('\n')

  const durationMin = Math.round(summary.totalDurationMs / 60000)

  return `你是一位经验丰富的开发者。请从以下任务执行结果中提取值得记住的经验教训。

## 任务信息
标题: ${summary.title}
描述: ${summary.description}
最终状态: ${summary.finalStatus}
总耗时: ${durationMin} 分钟

## 节点执行情况
${nodeLines}

## 要求
请分析以上执行结果，提取**有复用价值**的经验。注意：
1. 只提取可能在未来任务中复用的经验，不要记录琐碎细节
2. 关注：踩过的坑、发现的模式、有效的解决方案、工具使用技巧
3. 跳过：具体的文件路径、一次性的配置、显而易见的常识
4. 最多提取 5 条

请以 JSON 数组格式返回，每条包含：
- content: 经验内容（简洁明了，1-2 句话）
- category: 分类，只能是 "pattern" | "lesson" | "preference" | "pitfall" | "tool"
- keywords: 关键词数组（3-5 个，用于后续检索）
- confidence: 置信度 0-1（这条经验的可靠程度）

示例：
\`\`\`json
[
  {
    "content": "vitest 测试必须使用隔离的数据目录，否则会删除生产数据",
    "category": "pitfall",
    "keywords": ["vitest", "测试隔离", "数据目录"],
    "confidence": 0.9
  }
]
\`\`\`

如果没有值得记录的经验，返回空数组 \`[]\`。
只返回 JSON，不要其他内容。`
}

export type { TaskSummary }
