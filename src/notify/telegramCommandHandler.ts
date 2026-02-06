/**
 * @deprecated 使用 handlers/commandHandler.ts 代替
 * 保留为 re-export 垫片，避免外部引用断裂
 */
export {
  handleCommand,
  handleRun as handleRunCommand,
  handleList as handleListCommand,
  handleLogs as handleLogsCommand,
  handleStop as handleStopCommand,
  handleResume as handleResumeCommand,
  handleGet as handleGetCommand,
  handleHelp as handleHelpCommand,
} from './handlers/commandHandler.js'
