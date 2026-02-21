/**
 * @entry Self-drive module - autonomous goal-driven execution
 *
 * Provides self-drive capabilities: goal management, scheduling,
 * and daemon integration for periodic health checks and self-evolution.
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
  type DriveGoal,
  type GoalType,
} from './goals.js'

// Scheduler
export {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from './scheduler.js'

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
