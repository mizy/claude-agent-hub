import { Command } from 'commander'
import chalk from 'chalk'
import { getAllVersions, getPromptVersion } from '../../store/PromptVersionStore.js'
import { rollbackVersion } from '../../prompt-optimization/index.js'
import { success, error, info, table } from '../output.js'

export function registerPromptCommands(program: Command) {
  const prompt = program.command('prompt').description('Prompt 版本管理')

  prompt
    .command('versions')
    .description('列出 persona 的 prompt 版本')
    .argument('<persona>', 'Persona 名称 (如 Pragmatist)')
    .action(personaName => {
      const versions = getAllVersions(personaName)

      if (versions.length === 0) {
        info(`${personaName} 暂无 prompt 版本`)
        return
      }

      console.log(chalk.bold(`\n${personaName} Prompt 版本 (${versions.length})\n`))

      table(
        versions.map(v => ({
          version: `v${v.version}`,
          id: v.id.slice(0, 12),
          status: v.status,
          rate: v.stats.totalTasks > 0 ? `${(v.stats.successRate * 100).toFixed(0)}%` : '-',
          tasks: String(v.stats.totalTasks),
          created: v.createdAt.slice(0, 10),
        })),
        [
          { key: 'version', header: '版本', width: 6 },
          { key: 'id', header: 'ID', width: 12 },
          { key: 'status', header: '状态', width: 10 },
          { key: 'rate', header: '成功率', width: 6 },
          { key: 'tasks', header: '任务数', width: 6 },
          { key: 'created', header: '创建时间', width: 10 },
        ],
      )

      console.log()
    })

  prompt
    .command('rollback')
    .description('回滚到指定版本')
    .argument('<persona>', 'Persona 名称')
    .argument('<version-id>', '目标版本 ID')
    .action((personaName, versionId) => {
      const result = rollbackVersion(personaName, versionId)
      if (result) {
        success(`已回滚 ${personaName} 到 v${result.version} (${result.id})`)
      } else {
        error(`回滚失败: 版本 ${versionId} 不存在`)
      }
    })

  prompt
    .command('diff')
    .description('对比两个版本的 prompt')
    .argument('<persona>', 'Persona 名称')
    .argument('<v1>', '版本 1 ID')
    .argument('<v2>', '版本 2 ID')
    .action((personaName, v1Id, v2Id) => {
      const v1 = getPromptVersion(personaName, v1Id)
      const v2 = getPromptVersion(personaName, v2Id)

      if (!v1) {
        error(`版本不存在: ${v1Id}`)
        return
      }
      if (!v2) {
        error(`版本不存在: ${v2Id}`)
        return
      }

      console.log(chalk.bold(`\n${personaName} Prompt Diff: v${v1.version} → v${v2.version}\n`))

      console.log(chalk.cyan('--- v' + v1.version + ' (' + v1.id + ')'))
      console.log(chalk.green('+++ v' + v2.version + ' (' + v2.id + ')'))
      console.log()

      // Simple line-by-line diff
      const lines1 = v1.systemPrompt.split('\n')
      const lines2 = v2.systemPrompt.split('\n')
      const maxLines = Math.max(lines1.length, lines2.length)

      for (let i = 0; i < maxLines; i++) {
        const l1 = lines1[i]
        const l2 = lines2[i]

        if (l1 === l2) {
          console.log(chalk.gray(`  ${l1 ?? ''}`))
        } else {
          if (l1 !== undefined) {
            console.log(chalk.red(`- ${l1}`))
          }
          if (l2 !== undefined) {
            console.log(chalk.green(`+ ${l2}`))
          }
        }
      }

      console.log()

      // Show changelogs
      if (v2.changelog) {
        console.log(chalk.yellow(`Changelog (v${v2.version}): ${v2.changelog}`))
      }
      console.log()
    })
}
