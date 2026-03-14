/**
 * @entry Milestones module — project history and identity context
 *
 * Provides:
 * - generateMilestones(): Extract milestones from git history
 * - loadMilestones(): Read cached milestones from disk
 * - getIdentityContext(): Generate self-awareness text
 */

export { generateMilestones, loadMilestones, MILESTONES_PATH } from './generateMilestones.js'
export type { Milestone, MilestonesData } from './generateMilestones.js'
export { getIdentityContext } from './identityContext.js'
