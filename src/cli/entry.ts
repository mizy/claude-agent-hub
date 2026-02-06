#!/usr/bin/env node
/**
 * 统一入口 - 支持 SEA 二进制打包
 *
 * 通过 --subprocess 参数分发到不同模式：
 *   cah                           → CLI 主入口
 *   cah --subprocess=task ...     → 后台任务执行进程
 *   cah --subprocess=queue        → 后台队列运行进程
 */

const subprocessArg = process.argv.find(a => a.startsWith('--subprocess='))
const mode = subprocessArg?.split('=')[1]

if (mode === 'task') {
  // 移除 --subprocess=task 参数，保留其他参数给子进程
  process.argv = process.argv.filter(a => !a.startsWith('--subprocess='))
  import('../task/runTaskProcess.js')
} else if (mode === 'queue') {
  process.argv = process.argv.filter(a => !a.startsWith('--subprocess='))
  import('../task/runQueueProcess.js')
} else {
  import('./index.js')
}
