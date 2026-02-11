import { Command } from 'commander'
import chalk from 'chalk'
import { listMemories, addMemory, searchMemories, removeMemory } from '../../memory/index.js'
import type { MemoryCategory } from '../../memory/index.js'
import { success, error, info, table } from '../output.js'

const VALID_CATEGORIES: MemoryCategory[] = ['pattern', 'lesson', 'preference', 'pitfall', 'tool']

function formatCategory(cat: MemoryCategory): string {
  const map: Record<MemoryCategory, string> = {
    pattern: '模式',
    lesson: '经验',
    preference: '偏好',
    pitfall: '陷阱',
    tool: '工具',
  }
  return map[cat] || cat
}

export function registerMemoryCommands(program: Command) {
  const memory = program.command('memory').description('记忆管理命令')

  memory
    .command('list')
    .description('列出记忆')
    .option('-c, --category <category>', `按类别过滤 (${VALID_CATEGORIES.join('/')})`)
    .option('--project', '只显示当前项目的记忆')
    .action(options => {
      const filter: { category?: MemoryCategory; projectPath?: string } = {}

      if (options.category) {
        if (!VALID_CATEGORIES.includes(options.category)) {
          error(`无效类别: ${options.category}`)
          console.log(chalk.gray(`  可选: ${VALID_CATEGORIES.join(', ')}`))
          return
        }
        filter.category = options.category as MemoryCategory
      }

      if (options.project) {
        filter.projectPath = process.cwd()
      }

      const memories = listMemories(Object.keys(filter).length > 0 ? filter : undefined)

      if (memories.length === 0) {
        info('暂无记忆')
        return
      }

      console.log(chalk.bold(`\n记忆列表 (${memories.length})\n`))

      table(
        memories.map(m => ({
          id: m.id.slice(0, 8),
          category: formatCategory(m.category),
          content: m.content.length > 50 ? m.content.slice(0, 47) + '...' : m.content,
          confidence: (m.confidence * 100).toFixed(0) + '%',
          access: String(m.accessCount),
        })),
        [
          { key: 'id', header: 'ID', width: 8 },
          { key: 'category', header: '类别', width: 6 },
          { key: 'content', header: '内容', width: 50 },
          { key: 'confidence', header: '置信度', width: 6 },
          { key: 'access', header: '访问', width: 4 },
        ],
      )

      console.log()
    })

  memory
    .command('add')
    .description('手动添加记忆')
    .argument('<content>', '记忆内容')
    .option('-c, --category <category>', '类别', 'lesson')
    .action((content, options) => {
      const category = options.category as MemoryCategory
      if (!VALID_CATEGORIES.includes(category)) {
        error(`无效类别: ${category}`)
        console.log(chalk.gray(`  可选: ${VALID_CATEGORIES.join(', ')}`))
        return
      }

      const entry = addMemory(content, category, { type: 'manual' })
      success('记忆已添加')
      console.log(chalk.gray(`  ID: ${entry.id}`))
      console.log(chalk.gray(`  类别: ${formatCategory(category)}`))
    })

  memory
    .command('search')
    .description('搜索记忆')
    .argument('<query>', '搜索关键词')
    .action(query => {
      const results = searchMemories(query)

      if (results.length === 0) {
        info(`未找到匹配 "${query}" 的记忆`)
        return
      }

      console.log(chalk.bold(`\n搜索结果 (${results.length})\n`))

      table(
        results.map(m => ({
          id: m.id.slice(0, 8),
          category: formatCategory(m.category),
          content: m.content.length > 50 ? m.content.slice(0, 47) + '...' : m.content,
          keywords: m.keywords.slice(0, 3).join(', '),
        })),
        [
          { key: 'id', header: 'ID', width: 8 },
          { key: 'category', header: '类别', width: 6 },
          { key: 'content', header: '内容', width: 50 },
          { key: 'keywords', header: '关键词' },
        ],
      )

      console.log()
    })

  memory
    .command('delete')
    .alias('rm')
    .description('删除记忆')
    .argument('<id>', '记忆 ID')
    .action(id => {
      const deleted = removeMemory(id)
      if (deleted) {
        success(`已删除记忆: ${id}`)
      } else {
        error(`未找到记忆: ${id}`)
      }
    })
}
