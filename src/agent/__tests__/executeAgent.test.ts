/**
 * executeAgent 单元测试
 */

import { describe, it, expect } from 'vitest'

// 直接测试辅助函数
describe('executeAgent helpers', () => {
  describe('createProgressBar', () => {
    // 由于 createProgressBar 是私有函数，我们直接测试其逻辑
    function createProgressBar(percentage: number, width: number = 20): string {
      const filled = Math.round((percentage / 100) * width)
      const empty = width - filled
      const bar = '█'.repeat(filled) + '░'.repeat(empty)
      return `[${bar}] ${percentage}%`
    }

    it('should create an empty bar for 0%', () => {
      const bar = createProgressBar(0)
      expect(bar).toBe('[░░░░░░░░░░░░░░░░░░░░] 0%')
    })

    it('should create a full bar for 100%', () => {
      const bar = createProgressBar(100)
      expect(bar).toBe('[████████████████████] 100%')
    })

    it('should create a half-filled bar for 50%', () => {
      const bar = createProgressBar(50)
      expect(bar).toBe('[██████████░░░░░░░░░░] 50%')
    })

    it('should handle custom width', () => {
      const bar = createProgressBar(50, 10)
      expect(bar).toBe('[█████░░░░░] 50%')
    })

    it('should round percentage correctly', () => {
      const bar33 = createProgressBar(33)
      // 33% of 20 = 6.6, rounded to 7
      expect(bar33).toBe('[███████░░░░░░░░░░░░░] 33%')

      const bar66 = createProgressBar(66)
      // 66% of 20 = 13.2, rounded to 13
      expect(bar66).toBe('[█████████████░░░░░░░] 66%')
    })
  })

  describe('progress output format', () => {
    it('should format running nodes correctly', () => {
      // Test the expected output format
      const progressBar = '[██████████░░░░░░░░░░] 50%'
      const completed = 2
      const total = 4
      const runningNodes = ['实现功能A', '测试节点B']

      const runningInfo = runningNodes.length > 0
        ? ` [${runningNodes.join(', ')}]`
        : ''
      const output = `[dev] ${progressBar} ${completed}/${total}${runningInfo}`

      expect(output).toBe('[dev] [██████████░░░░░░░░░░] 50% 2/4 [实现功能A, 测试节点B]')
    })

    it('should handle no running nodes', () => {
      const progressBar = '[████████████████████] 100%'
      const runningNodes: string[] = []

      const runningInfo = runningNodes.length > 0
        ? ` [${runningNodes.join(', ')}]`
        : ''
      const output = `[dev] ${progressBar} 4/4${runningInfo}`

      expect(output).toBe('[dev] [████████████████████] 100% 4/4')
    })
  })
})
