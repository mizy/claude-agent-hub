/**
 * CLI: backend management sub-commands
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { success, info } from '../output.js'

export function registerBackendCommands(program: Command) {
  const backend = program.command('backend').description('Backend 管理')

  backend
    .command('list')
    .description('列出所有可用的 backend')
    .action(async () => {
      const { getRegisteredBackends } = await import('../../backend/index.js')
      const { loadConfig } = await import('../../config/index.js')

      const config = await loadConfig()
      const registered = getRegisteredBackends()
      const defaultConfig = config.backend
      const namedBackends = config.backends ?? {}
      const defaultBackendName = config.defaultBackend

      success('已注册的 backend:')
      console.log()

      for (const name of registered) {
        const isDefault =
          (!defaultBackendName && name === defaultConfig.type) ||
          (defaultBackendName && namedBackends[defaultBackendName]?.type === name)
        const marker = isDefault ? chalk.green(' (默认)') : ''
        console.log(`  ${chalk.bold(name)}${marker}`)
      }

      // 显示命名 backend
      const namedEntries = Object.entries(namedBackends)
      if (namedEntries.length > 0) {
        console.log()
        success('命名 backend:')
        console.log()
        for (const [alias, cfg] of namedEntries) {
          const isDefault = defaultBackendName === alias
          const marker = isDefault ? chalk.green(' (默认)') : ''
          console.log(`  ${chalk.bold(alias)}${marker}  →  type: ${cfg.type}, model: ${cfg.model}`)
        }
      }
    })

  backend
    .command('current')
    .description('显示当前使用的 backend 和 model')
    .action(async () => {
      const { getBackendConfig } = await import('../../config/index.js')
      const { resolveBackend } = await import('../../backend/index.js')

      const backendConfig = await getBackendConfig()
      const backendInstance = await resolveBackend()

      info(`Backend: ${chalk.bold(backendInstance.displayName)}`)
      info(`Type:    ${chalk.bold(backendConfig.type)}`)
      info(`Model:   ${chalk.bold(backendConfig.model)}`)
    })
}
