/**
 * 任务模板命令
 */

import { Command } from 'commander'
import chalk from 'chalk'
import {
  initBuiltinTemplates,
  getAllTemplates,
  getTemplatesByCategory,
  getTemplate,
  createTemplate,
  deleteTemplate,
  applyTemplate,
  searchTemplates,
  suggestTemplates,
  createTemplateFromTask,
  getTasksAvailableForTemplate,
  getTemplateRanking,
  recalculateAllEffectivenessScores,
  CATEGORY_LABELS,
} from '../../template/TaskTemplate.js'
import type { TemplateCategory, TaskTemplate } from '../../template/TaskTemplate.js'
import { success, error, info, warn } from '../output.js'

export function registerTemplateCommands(program: Command) {
  const template = program
    .command('template')
    .alias('tpl')
    .description('任务模板管理')

  // 初始化内置模板
  template
    .command('init')
    .description('初始化内置模板')
    .action(() => {
      initBuiltinTemplates()
      success('内置模板已初始化')
    })

  // 列出模板
  template
    .command('list')
    .alias('ls')
    .description('列出所有模板')
    .option('-c, --category <category>', '按分类筛选')
    .action((options) => {
      let templates: TaskTemplate[]

      if (options.category) {
        templates = getTemplatesByCategory(options.category as TemplateCategory)
      } else {
        templates = getAllTemplates()
      }

      if (templates.length === 0) {
        warn('没有找到模板')
        info('运行 `cah template init` 初始化内置模板')
        return
      }

      console.log('')
      console.log(chalk.cyan.bold('  任务模板'))
      console.log('')

      // 按分类分组
      const grouped = new Map<TemplateCategory, TaskTemplate[]>()
      for (const tpl of templates) {
        if (!grouped.has(tpl.category)) {
          grouped.set(tpl.category, [])
        }
        grouped.get(tpl.category)!.push(tpl)
      }

      for (const [category, tpls] of grouped.entries()) {
        console.log(chalk.yellow(`  [${CATEGORY_LABELS[category]}]`))
        for (const tpl of tpls) {
          const usage = tpl.usageCount > 0 ? chalk.dim(` (${tpl.usageCount}次)`) : ''
          console.log(`    ${chalk.green(tpl.id)} - ${tpl.description}${usage}`)
        }
        console.log('')
      }

      console.log(chalk.dim(`  共 ${templates.length} 个模板`))
      console.log(chalk.dim('  使用 `cah template show <id>` 查看详情'))
      console.log('')
    })

  // 查看模板详情
  template
    .command('show')
    .description('查看模板详情')
    .argument('<id>', '模板 ID')
    .action((id) => {
      const tpl = getTemplate(id)
      if (!tpl) {
        error(`模板不存在: ${id}`)
        return
      }

      console.log('')
      console.log(chalk.cyan.bold(`  模板: ${tpl.name}`))
      console.log('')
      console.log(`  ${chalk.dim('ID:')} ${tpl.id}`)
      console.log(`  ${chalk.dim('分类:')} ${CATEGORY_LABELS[tpl.category]}`)
      console.log(`  ${chalk.dim('描述:')} ${tpl.description}`)
      if (tpl.tags && tpl.tags.length > 0) {
        console.log(`  ${chalk.dim('标签:')} ${tpl.tags.join(', ')}`)
      }
      console.log(`  ${chalk.dim('使用次数:')} ${tpl.usageCount}`)
      console.log('')
      console.log(chalk.dim('  Prompt 模板:'))
      console.log(chalk.gray('  ─'.repeat(30)))
      console.log(tpl.prompt.split('\n').map(l => '  ' + l).join('\n'))
      console.log(chalk.gray('  ─'.repeat(30)))
      console.log('')

      if (tpl.variables && tpl.variables.length > 0) {
        console.log(chalk.dim('  变量:'))
        for (const v of tpl.variables) {
          const required = v.required ? chalk.red('*') : ''
          const defaultVal = v.defaultValue ? chalk.dim(` (默认: ${v.defaultValue})`) : ''
          console.log(`    ${required}${chalk.green(v.name)} - ${v.description}${defaultVal}`)
        }
        console.log('')
      }

      console.log(chalk.dim('  使用方法:'))
      console.log(chalk.gray(`    cah template use ${tpl.id} --var key=value`))
      console.log('')
    })

  // 使用模板
  template
    .command('use')
    .description('使用模板生成任务')
    .argument('<id>', '模板 ID')
    .option('-v, --var <vars...>', '变量值 (格式: key=value)')
    .option('--dry-run', '仅显示生成的 prompt，不创建任务')
    .action((id, options) => {
      const tpl = getTemplate(id)
      if (!tpl) {
        error(`模板不存在: ${id}`)
        return
      }

      // 解析变量
      const variables: Record<string, string> = {}
      if (options.var) {
        for (const v of options.var) {
          const [key, ...valueParts] = v.split('=')
          if (key) {
            variables[key] = valueParts.join('=')
          }
        }
      }

      // 检查必填变量
      if (tpl.variables) {
        for (const v of tpl.variables) {
          if (v.required && !variables[v.name] && !v.defaultValue) {
            error(`缺少必填变量: ${v.name}`)
            console.log(chalk.dim(`  使用 --var ${v.name}=<value> 指定`))
            return
          }
        }
      }

      // 应用模板
      const prompt = applyTemplate(id, variables)
      if (!prompt) {
        error('模板应用失败')
        return
      }

      if (options.dryRun) {
        console.log('')
        console.log(chalk.cyan('  生成的任务描述:'))
        console.log(chalk.gray('  ─'.repeat(30)))
        console.log(prompt.split('\n').map(l => '  ' + l).join('\n'))
        console.log(chalk.gray('  ─'.repeat(30)))
        console.log('')
        console.log(chalk.dim('  移除 --dry-run 以创建任务'))
        return
      }

      // 输出 prompt 供 CLI 使用
      console.log(prompt)
    })

  // 搜索模板
  template
    .command('search')
    .description('搜索模板')
    .argument('<query>', '搜索关键词')
    .action((query) => {
      const results = searchTemplates(query)

      if (results.length === 0) {
        warn(`没有找到匹配 "${query}" 的模板`)
        return
      }

      console.log('')
      console.log(chalk.cyan(`  搜索结果: "${query}"`))
      console.log('')

      for (const tpl of results) {
        console.log(`  ${chalk.green(tpl.id)}`)
        console.log(`    ${tpl.description}`)
        console.log(`    ${chalk.dim(`分类: ${CATEGORY_LABELS[tpl.category]}`)}\n`)
      }

      console.log(chalk.dim(`  共 ${results.length} 个结果`))
      console.log('')
    })

  // 创建自定义模板
  template
    .command('create')
    .description('创建自定义模板')
    .requiredOption('-n, --name <name>', '模板名称')
    .requiredOption('-d, --description <desc>', '模板描述')
    .requiredOption('-p, --prompt <prompt>', '模板 prompt')
    .option('-c, --category <category>', '分类', 'custom')
    .option('-t, --tags <tags>', '标签 (逗号分隔)')
    .action((options) => {
      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined

      const tpl = createTemplate(options.name, options.description, options.prompt, {
        category: options.category as TemplateCategory,
        tags,
      })

      success(`模板已创建: ${tpl.id}`)
      console.log(chalk.dim(`  使用 \`cah template show ${tpl.id}\` 查看详情`))
    })

  // 删除模板
  template
    .command('delete')
    .alias('rm')
    .description('删除模板')
    .argument('<id>', '模板 ID')
    .action((id) => {
      const result = deleteTemplate(id)
      if (result) {
        success(`模板已删除: ${id}`)
      } else {
        error(`模板不存在: ${id}`)
      }
    })

  // 基于任务描述推荐模板
  template
    .command('suggest')
    .description('基于任务描述推荐模板')
    .argument('<description>', '任务描述')
    .option('-n, --limit <num>', '返回数量', '5')
    .action((description, options) => {
      const limit = parseInt(options.limit, 10) || 5
      const suggestions = suggestTemplates(description, limit)

      if (suggestions.length === 0) {
        warn('没有找到匹配的模板')
        info('运行 `cah template init` 初始化内置模板')
        return
      }

      console.log('')
      console.log(chalk.cyan.bold(`  推荐模板 (基于: "${description.slice(0, 30)}${description.length > 30 ? '...' : ''}")`))
      console.log('')

      suggestions.forEach((suggestion, i) => {
        const { template: tpl, score, reason } = suggestion
        const scoreBar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10))
        const effectiveness = tpl.effectivenessScore !== undefined
          ? chalk.dim(` [有效性: ${tpl.effectivenessScore}%]`)
          : ''

        console.log(`  ${chalk.yellow(`${i + 1}.`)} ${chalk.green(tpl.id)}${effectiveness}`)
        console.log(`     ${tpl.description}`)
        console.log(`     ${chalk.dim('匹配度:')} ${scoreBar} ${chalk.cyan(score)}`)
        console.log(`     ${chalk.dim('原因:')} ${reason}`)
        console.log('')
      })

      console.log(chalk.dim('  使用 `cah template use <id>` 应用模板'))
      console.log('')
    })

  // 从历史任务创建模板
  template
    .command('from-task')
    .description('从历史任务创建模板')
    .argument('[taskId]', '任务 ID (可选，不指定则列出可用任务)')
    .action((taskId) => {
      if (!taskId) {
        // 列出可用于生成模板的任务
        const tasks = getTasksAvailableForTemplate()

        if (tasks.length === 0) {
          warn('没有已完成的任务')
          return
        }

        console.log('')
        console.log(chalk.cyan.bold('  可用于生成模板的任务'))
        console.log('')

        for (const task of tasks.slice(0, 20)) {
          console.log(`  ${chalk.green(task.id)}`)
          console.log(`    ${task.title}`)
          console.log(`    ${chalk.dim(`创建于: ${new Date(task.createdAt).toLocaleString()}`)}`)
          console.log('')
        }

        if (tasks.length > 20) {
          console.log(chalk.dim(`  ... 还有 ${tasks.length - 20} 个任务`))
        }

        console.log(chalk.dim('  使用 `cah template from-task <taskId>` 创建模板'))
        console.log('')
        return
      }

      // 从指定任务创建模板
      const tpl = createTemplateFromTask(taskId)

      if (!tpl) {
        error(`无法从任务创建模板: ${taskId}`)
        info('请确保任务已完成 (status: completed)')
        return
      }

      success(`模板已创建: ${tpl.id}`)
      console.log('')
      console.log(`  ${chalk.dim('来源任务:')} ${taskId}`)
      console.log(`  ${chalk.dim('描述:')} ${tpl.description}`)
      console.log(`  ${chalk.dim('分类:')} ${CATEGORY_LABELS[tpl.category]}`)
      if (tpl.tags) {
        console.log(`  ${chalk.dim('标签:')} ${tpl.tags.join(', ')}`)
      }
      console.log('')
      console.log(chalk.dim(`  使用 \`cah template show ${tpl.id}\` 查看详情`))
      console.log('')
    })

  // 查看模板排行榜（按有效性评分）
  template
    .command('ranking')
    .description('查看模板有效性排行榜')
    .action(() => {
      const ranking = getTemplateRanking()

      if (ranking.length === 0) {
        warn('没有带有效性评分的模板')
        info('模板使用后会自动计算有效性评分')
        return
      }

      console.log('')
      console.log(chalk.cyan.bold('  模板有效性排行榜'))
      console.log('')

      ranking.forEach((tpl, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
        const total = (tpl.successCount || 0) + (tpl.failureCount || 0)
        const scoreColor = (tpl.effectivenessScore || 0) >= 80 ? chalk.green
          : (tpl.effectivenessScore || 0) >= 50 ? chalk.yellow
          : chalk.red

        console.log(`  ${medal} ${chalk.green(tpl.id)}`)
        console.log(`     ${tpl.description}`)
        console.log(`     ${chalk.dim('有效性:')} ${scoreColor(`${tpl.effectivenessScore}%`)} ${chalk.dim(`(${tpl.successCount || 0}成功/${tpl.failureCount || 0}失败, 共${total}次)`)}`)
        console.log('')
      })
    })

  // 重新计算所有模板的有效性评分
  template
    .command('recalculate')
    .description('从历史数据重新计算模板有效性评分')
    .action(() => {
      recalculateAllEffectivenessScores()
      success('已重新计算所有模板的有效性评分')
      info('运行 `cah template ranking` 查看排行榜')
    })
}
