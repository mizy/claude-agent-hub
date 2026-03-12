/**
 * @entry Self-drive module - autonomous goal-driven execution
 *
 * Provides self-drive capabilities: goal management, scheduling,
 * and daemon integration for periodic health checks and self-evolution.
 *
 * 公共 API:
 * - Goal CRUD: addGoal / updateGoal / removeGoal / getGoal / listGoals / listEnabledGoals
 * - Goal 控制: enableGoal / disableGoal / updateGoalSchedule / markGoalRun / ensureBuiltinGoals
 * - Scheduler: startScheduler / stopScheduler / getSchedulerStatus
 * - Daemon 集成: startSelfDrive / stopSelfDrive / disableSelfDrive / enableSelfDrive
 *   isSelfDrivePermanentlyDisabled / getSelfDriveStatus / resumeSelfDriveIfEnabled
 * - Types: DriveGoal, GoalType
 */

// Goal management
export {
  addGoal,
  updateGoal,
  removeGoal,
  getGoal,
  listGoals,
  listEnabledGoals,
  ensureBuiltinGoals,
  markGoalRun,
  enableGoal,
  disableGoal,
  updateGoalSchedule,
  type DriveGoal,
  type GoalType,
} from './goals.js'

// Scheduler
export {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from './scheduler.js'

// Workflow-based self-drive
export { ensureSelfDriveWorkflow } from './ensureSelfDriveWorkflow.js'

// Daemon integration
export {
  startSelfDrive,
  stopSelfDrive,
  disableSelfDrive,
  enableSelfDrive,
  isSelfDrivePermanentlyDisabled,
  getSelfDriveStatus,
  resumeSelfDriveIfEnabled,
} from './daemon.js'
