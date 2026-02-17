import type { HealthCheck, Diagnosis } from '../types.js'

export const backendAvailabilityCheck: HealthCheck = {
  name: 'backend-availability',
  description: 'Check that the configured backend CLI is available',
  async run() {
    const details: string[] = []
    let score = 100
    let diagnosis: Diagnosis | undefined

    try {
      const { resolveBackend } = await import('../../backend/resolveBackend.js')
      const backend = await resolveBackend()

      details.push(`Backend: ${backend.displayName}`)

      const available = await backend.checkAvailable()
      if (!available) {
        score -= 40
        details.push(`${backend.displayName} is not available (CLI not found or not working)`)
        diagnosis = {
          category: 'config_error',
          rootCause: `Backend "${backend.displayName}" CLI is not installed or not in PATH`,
          suggestedFix: `Install ${backend.displayName} or switch to a different backend in config`,
        }
      } else {
        details.push(`${backend.displayName} is available`)
      }
    } catch (error) {
      score -= 30
      const msg = error instanceof Error ? error.message : String(error)
      details.push(`Failed to resolve backend: ${msg}`)
      diagnosis = {
        category: 'config_error',
        rootCause: `Cannot resolve configured backend: ${msg}`,
        suggestedFix: 'Check backend configuration in cah.yaml',
      }
    }

    score = Math.max(0, score)
    const status = score >= 80 ? (score === 100 ? 'pass' : 'warning') : 'fail'

    return { name: this.name, status, score, details, fixable: false, diagnosis }
  },
}
