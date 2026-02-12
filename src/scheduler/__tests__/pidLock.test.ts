/**
 * pidLock 测试
 *
 * 测试 PID 锁的获取、释放和冲突检测
 * 使用隔离的临时数据目录
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getPidLock,
  acquirePidLock,
  releasePidLock,
  isServiceRunning,
  isProcessRunning,
} from '../pidLock.js'

// DATA_DIR is set to temp dir by vitest.config.ts env CAH_DATA_DIR

describe('pidLock', () => {
  beforeEach(() => {
    // Clean up any stale lock files
    releasePidLock('daemon')
    releasePidLock('dashboard')
  })

  afterEach(() => {
    releasePidLock('daemon')
    releasePidLock('dashboard')
  })

  describe('getPidLock', () => {
    it('should return null when no lock file exists', () => {
      const lock = getPidLock('daemon')
      expect(lock).toBeNull()
    })

    it('should return lock info after acquiring', () => {
      const result = acquirePidLock('daemon')
      expect(result.success).toBe(true)

      const lock = getPidLock('daemon')
      expect(lock).not.toBeNull()
      expect(lock!.pid).toBe(process.pid)
      expect(lock!.startedAt).toBeTruthy()
      expect(lock!.cwd).toBeTruthy()
    })
  })

  describe('acquirePidLock', () => {
    it('should acquire lock successfully when no lock exists', () => {
      const result = acquirePidLock('daemon')
      expect(result.success).toBe(true)
    })

    it('should fail to acquire if current process already holds lock', () => {
      // First acquisition
      const result1 = acquirePidLock('daemon')
      expect(result1.success).toBe(true)

      // Second acquisition by same process (process.pid is running)
      const result2 = acquirePidLock('daemon')
      expect(result2.success).toBe(false)
      if (!result2.success) {
        expect(result2.existingLock.pid).toBe(process.pid)
      }
    })

    it('should support both daemon and dashboard services', () => {
      const r1 = acquirePidLock('daemon')
      const r2 = acquirePidLock('dashboard')

      expect(r1.success).toBe(true)
      expect(r2.success).toBe(true)

      // Both should have separate lock files
      expect(getPidLock('daemon')).not.toBeNull()
      expect(getPidLock('dashboard')).not.toBeNull()
    })
  })

  describe('releasePidLock', () => {
    it('should remove lock file', () => {
      acquirePidLock('daemon')
      expect(getPidLock('daemon')).not.toBeNull()

      releasePidLock('daemon')
      expect(getPidLock('daemon')).toBeNull()
    })

    it('should not throw when no lock file exists', () => {
      // Should not throw
      releasePidLock('daemon')
      releasePidLock('dashboard')
    })
  })

  describe('isProcessRunning', () => {
    it('should return true for the current process', () => {
      expect(isProcessRunning(process.pid)).toBe(true)
    })

    it('should return false for a non-existent PID', () => {
      // Use a very high PID unlikely to exist
      expect(isProcessRunning(999999)).toBe(false)
    })

    it('should return true when EPERM error occurs', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })

      expect(isProcessRunning(1)).toBe(true)
      killSpy.mockRestore()
    })

    it('should return false when ESRCH error occurs', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException
        err.code = 'ESRCH'
        throw err
      })

      expect(isProcessRunning(99999)).toBe(false)
      killSpy.mockRestore()
    })
  })

  describe('isServiceRunning', () => {
    it('should return running=false when no lock exists', () => {
      const status = isServiceRunning('daemon')
      expect(status.running).toBe(false)
      expect(status.lock).toBeUndefined()
    })

    it('should return running=true when current process holds lock', () => {
      acquirePidLock('daemon')

      const status = isServiceRunning('daemon')
      expect(status.running).toBe(true)
      expect(status.lock).toBeDefined()
      expect(status.lock!.pid).toBe(process.pid)
    })

    it('should default to daemon service', () => {
      acquirePidLock() // defaults to 'daemon'
      const status = isServiceRunning() // defaults to 'daemon'
      expect(status.running).toBe(true)
    })
  })
})
