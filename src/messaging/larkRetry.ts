import { createLogger } from '../shared/logger.js'

const logger = createLogger('lark-retry')

/** Simple retry for transient Lark API failures (network, rate limit, TLS disconnect) */
export async function withLarkRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 2): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < maxRetries) {
        const delay = 500 * (attempt + 1)
        logger.debug(`${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}
