/**
 * Runtime bootstrap for process entrypoints.
 *
 * Centralizes listener registration so CLI, daemon, and worker
 * processes can share the same startup wiring.
 */
import { registerTaskEventListeners } from '../messaging/registerTaskEventListeners.js'
import { registerConsciousnessListeners } from '../consciousness/index.js'
import { registerSelfdriveListeners } from '../selfdrive/registerSelfdriveListeners.js'
import { registerGrowthJournalListeners } from '../consciousness/registerGrowthJournalListeners.js'
import { registerValueListeners } from '../consciousness/registerValueListeners.js'

let bootstrapped = false

export function bootstrapRuntime(): void {
  if (bootstrapped) return
  bootstrapped = true

  registerTaskEventListeners()
  registerConsciousnessListeners()
  registerSelfdriveListeners()
  registerGrowthJournalListeners()
  registerValueListeners()
}
