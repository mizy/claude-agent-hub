import { execa } from 'execa'

interface CommitOptions {
  message: string
  files?: string[]
}

/**
 * 提交代码变更
 */
export async function commitChanges(options: CommitOptions): Promise<string> {
  const { message, files } = options

  // 添加文件到暂存区
  if (files && files.length > 0) {
    await execa('git', ['add', ...files])
  } else {
    await execa('git', ['add', '-A'])
  }

  // 检查是否有变更
  const { stdout: status } = await execa('git', ['status', '--porcelain'])
  if (!status.trim()) {
    console.log('没有需要提交的更改')
    return ''
  }

  // 提交
  const { stdout } = await execa('git', ['commit', '-m', message])

  // 获取 commit hash
  const { stdout: hash } = await execa('git', ['rev-parse', 'HEAD'])

  return hash.trim()
}

/**
 * 获取最近的提交记录
 */
export async function getRecentCommits(count: number = 10): Promise<string[]> {
  const { stdout } = await execa('git', [
    'log',
    `--oneline`,
    `-${count}`
  ])
  return stdout.split('\n').filter(Boolean)
}
