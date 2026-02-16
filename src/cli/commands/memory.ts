import { Command } from 'commander'
import chalk from 'chalk'
import {
  listMemories,
  addMemory,
  searchMemories,
  removeMemory,
  getMemoryHealth,
  reinforceMemory,
  cleanupFadingMemories,
  calculateStrength,
} from '../../memory/index.js'
import { getMemory } from '../../store/MemoryStore.js'
import { migrateMemoryEntry } from '../../memory/migrateMemory.js'
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

  // ── New memory management commands ──

  memory
    .command('health')
    .description('显示所有记忆的健康状态')
    .action(async () => {
      const health = await getMemoryHealth()

      if (health.length === 0) {
        info('暂无记忆')
        return
      }

      // Sort by strength ascending (weakest first)
      health.sort((a, b) => a.strength - b.strength)

      console.log(chalk.bold(`\n记忆健康状态 (${health.length})\n`))

      table(
        health.map(h => {
          let strengthColor = chalk.green
          if (h.strength < 30) strengthColor = chalk.red
          else if (h.strength < 60) strengthColor = chalk.yellow

          return {
            id: h.id.slice(0, 8),
            title: h.title.length > 40 ? h.title.slice(0, 37) + '...' : h.title,
            strength: strengthColor(`${h.strength}%`),
            fade: h.daysUntilFade === 0
              ? chalk.red('已消退')
              : h.daysUntilFade > 30
                ? chalk.green(`${h.daysUntilFade}天`)
                : chalk.yellow(`${h.daysUntilFade}天`),
          }
        }),
        [
          { key: 'id', header: 'ID', width: 8 },
          { key: 'title', header: '内容', width: 40 },
          { key: 'strength', header: '强度', width: 6 },
          { key: 'fade', header: '预计消退', width: 10 },
        ],
      )

      console.log()
    })

  memory
    .command('fading')
    .description('显示即将消退的记忆')
    .action(async () => {
      const health = await getMemoryHealth()
      const fading = health.filter(h => h.strength < 30 && h.strength > 0)

      if (fading.length === 0) {
        info('没有即将消退的记忆')
        return
      }

      fading.sort((a, b) => a.strength - b.strength)

      console.log(chalk.bold(`\n即将消退的记忆 (${fading.length})\n`))

      table(
        fading.map(h => ({
          id: h.id.slice(0, 8),
          title: h.title.length > 40 ? h.title.slice(0, 37) + '...' : h.title,
          strength: chalk.red(`${h.strength}%`),
          fade: h.daysUntilFade === 0 ? chalk.red('已消退') : chalk.yellow(`${h.daysUntilFade}天`),
        })),
        [
          { key: 'id', header: 'ID', width: 8 },
          { key: 'title', header: '内容', width: 40 },
          { key: 'strength', header: '强度', width: 6 },
          { key: 'fade', header: '预计消退', width: 10 },
        ],
      )

      console.log()
      console.log(chalk.gray('  提示: 使用 cah memory reinforce <id> 强化记忆'))
      console.log()
    })

  memory
    .command('reinforce')
    .description('手动强化一条记忆')
    .argument('<id>', '记忆 ID（支持前缀匹配）')
    .action(async (id) => {
      // Get current strength before reinforcement
      const raw = getMemory(id)
      if (!raw) {
        error(`未找到记忆: ${id}`)
        return
      }
      const before = calculateStrength(migrateMemoryEntry(raw))

      const result = await reinforceMemory(id, 'manual')
      if (!result) {
        error(`强化失败: ${id}`)
        return
      }

      const after = calculateStrength(result)
      success(`记忆已强化: ${id}`)
      console.log(chalk.gray(`  强度: ${before}% → ${after}%`))
      console.log(chalk.gray(`  稳定性: ${result.stability!.toFixed(0)}h`))
      console.log(chalk.gray(`  强化次数: ${result.reinforceCount}`))
    })

  memory
    .command('associations')
    .alias('assoc')
    .description('查看记忆的关联关系')
    .argument('<id>', '记忆 ID')
    .action((id) => {
      const raw = getMemory(id)
      if (!raw) {
        error(`未找到记忆: ${id}`)
        return
      }

      const entry = migrateMemoryEntry(raw)
      const assocs = entry.associations ?? []

      console.log(chalk.bold(`\n记忆关联: ${id.slice(0, 8)}\n`))
      console.log(chalk.gray(`  内容: ${entry.content.slice(0, 60)}`))
      console.log()

      if (assocs.length === 0) {
        info('暂无关联')
        return
      }

      for (const assoc of assocs.sort((a, b) => b.weight - a.weight)) {
        const target = getMemory(assoc.targetId)
        const targetTitle = target
          ? target.content.slice(0, 40) + (target.content.length > 40 ? '...' : '')
          : chalk.dim('(已删除)')

        const typeLabel: Record<string, string> = {
          keyword: '关键词',
          'co-task': '同任务',
          'co-project': '同项目',
          semantic: '语义',
        }
        const type = typeLabel[assoc.type] ?? assoc.type
        const weight = (assoc.weight * 100).toFixed(0) + '%'

        console.log(`  ├─ ${chalk.cyan(assoc.targetId.slice(0, 8))} [${type} ${weight}]`)
        console.log(`  │  ${chalk.gray(targetTitle)}`)
      }

      console.log()
    })

  memory
    .command('cleanup')
    .description('执行遗忘清理')
    .option('--dry-run', '只预览不执行')
    .action(async (options) => {
      if (options.dryRun) {
        // Preview mode: show what would be affected
        const health = await getMemoryHealth()
        const willArchive = health.filter(h => h.strength < 10 && h.strength >= 5)
        const willDelete = health.filter(h => h.strength < 5)

        console.log(chalk.bold('\n清理预览 (dry-run)\n'))

        if (willArchive.length > 0) {
          console.log(chalk.yellow(`  将归档: ${willArchive.length} 条`))
          for (const h of willArchive) {
            console.log(chalk.gray(`    - ${h.id.slice(0, 8)} ${h.title.slice(0, 40)} (强度: ${h.strength}%)`))
          }
        }

        if (willDelete.length > 0) {
          console.log(chalk.red(`  将删除: ${willDelete.length} 条`))
          for (const h of willDelete) {
            console.log(chalk.gray(`    - ${h.id.slice(0, 8)} ${h.title.slice(0, 40)} (强度: ${h.strength}%)`))
          }
        }

        if (willArchive.length === 0 && willDelete.length === 0) {
          info('没有需要清理的记忆')
        }
      } else {
        const result = await cleanupFadingMemories()
        success(`清理完成: 归档 ${result.archived} 条，删除 ${result.deleted} 条`)
      }

      console.log()
    })
}
