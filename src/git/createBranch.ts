import { execa } from 'execa'

/**
 * 创建新的 Git 分支
 */
export async function createBranch(branchName: string): Promise<void> {
  // 确保工作区干净
  const { stdout: status } = await execa('git', ['status', '--porcelain'])
  if (status.trim()) {
    throw new Error('工作区有未提交的更改，请先提交或暂存')
  }

  // 获取当前分支
  const { stdout: currentBranch } = await execa('git', ['branch', '--show-current'])

  // 从主分支创建新分支
  try {
    await execa('git', ['checkout', '-b', branchName])
    console.log(`创建并切换到分支: ${branchName}`)
  } catch (error: any) {
    // 分支已存在，直接切换
    if (error.message.includes('already exists')) {
      await execa('git', ['checkout', branchName])
      console.log(`切换到已有分支: ${branchName}`)
    } else {
      throw error
    }
  }
}

/**
 * 切换到指定分支
 */
export async function checkoutBranch(branchName: string): Promise<void> {
  await execa('git', ['checkout', branchName])
}

/**
 * 获取当前分支名
 */
export async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current'])
  return stdout.trim()
}

/**
 * 获取仓库默认分支
 * 优先从远程获取，失败则检测本地分支
 */
export async function getDefaultBranch(): Promise<string> {
  try {
    // 尝试从远程 HEAD 获取默认分支
    const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'])
    return stdout.replace('refs/remotes/origin/', '').trim()
  } catch {
    // 远程检测失败，检查本地是否有 main 或 master
    try {
      const { stdout: branches } = await execa('git', ['branch', '-l'])
      if (branches.includes('main')) {
        return 'main'
      }
      if (branches.includes('master')) {
        return 'master'
      }
    } catch {
      // ignore
    }
    // 默认返回 main
    return 'main'
  }
}
