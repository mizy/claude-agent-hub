/**
 * Lark interactive card builder — unified entry point
 *
 * Re-exports all card builders, element builders, and types from split modules.
 */

// Element builders & types
export {
  buildCard,
  mdElement,
  hrElement,
  noteElement,
  actionElement,
  button,
  taskDetailAction,
  taskLogsAction,
  taskStopAction,
  taskRetryAction,
  listPageAction,
  approveAction,
  rejectAction,
  taskPauseAction,
  taskResumeAction,
  taskMsgAction,
  autoWaitConfirmAction,
} from './larkCards/cardElements.js'
export type { LarkCard, LarkCardElement, LarkCardButton } from './larkCards/cardElements.js'

// Task lifecycle cards
export {
  buildTaskCreatedCard,
  buildTaskCompletedCard,
  buildTaskFailedCard,
  buildTaskListCard,
  buildTaskDetailCard,
  buildTaskLogsCard,
} from './larkCards/taskCards.js'
export type { TaskNodeInfo, TaskCardInfo, TaskListItem, TaskDetailInput } from './larkCards/taskCards.js'

// Interaction cards
export {
  buildApprovalCard,
  buildAutoWaitCard,
  buildWelcomeCard,
  buildStatusCard,
  buildHelpCard,
} from './larkCards/interactionCards.js'
