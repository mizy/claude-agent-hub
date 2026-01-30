import { execa } from 'execa'
import chalk from 'chalk'
import { getStore } from '../store/index.js'
import { loadConfig } from '../config/loadConfig.js'
import { getDefaultBranch } from './createBranch.js'

interface ApproveOptions {
  message?: string
}

/**
 * 审批并合并 PR 分支
 */
export async function approvePR(branch: string, options: ApproveOptions): Promise<void> {
  const config = await loadConfig()
  // 优先使用配置，否则动态检测默认分支
  const baseBranch = config.git?.base_branch || await getDefaultBranch()

  console.log(chalk.blue(`审批分支: ${branch}`))

  // 1. 切换到基础分支
  await execa('git', ['checkout', baseBranch])

  // 2. 拉取最新代码
  try {
    await execa('git', ['pull', 'origin', baseBranch])
  } catch {
    console.log(chalk.yellow('无法拉取远程代码，使用本地版本'))
  }

  // 3. 合并 feature 分支
  const mergeMessage = options.message || `Merge branch '${branch}'`
  await execa('git', ['merge', branch, '--no-ff', '-m', mergeMessage])

  console.log(chalk.green(`✓ 分支 ${branch} 已合并到 ${baseBranch}`))

  // 4. 推送（如果配置允许）
  if (config.git?.auto_push) {
    await execa('git', ['push', 'origin', baseBranch])
    console.log(chalk.green(`✓ 已推送到远程`))
  } else {
    console.log(chalk.yellow('自动推送已禁用，请手动执行: git push'))
  }

  // 5. 删除 feature 分支
  await execa('git', ['branch', '-d', branch])
  console.log(chalk.gray(`已删除本地分支: ${branch}`))
}
