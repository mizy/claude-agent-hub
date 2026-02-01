/**
 * projectContext 单元测试
 */

import { describe, it, expect } from 'vitest'
import { formatProjectContextForPrompt } from '../projectContext.js'
import type { ProjectContext } from '../projectContext.js'

describe('projectContext', () => {
  // 注意：analyzeProjectContext 依赖真实文件系统，更适合集成测试
  // 这里只测试格式化函数

  describe('formatProjectContextForPrompt', () => {
    it('should format context correctly', () => {
      const context: ProjectContext = {
        projectType: 'nodejs',
        mainLanguage: 'typescript',
        packageManager: 'pnpm',
        frameworks: ['express', 'vitest'],
        directoryStructure: 'src/\n  index.ts',
        keyFiles: ['package.json', 'tsconfig.json'],
        scripts: { build: 'tsc', test: 'vitest' },
      }

      const prompt = formatProjectContextForPrompt(context)

      expect(prompt).toContain('## 项目信息')
      expect(prompt).toContain('类型: nodejs')
      expect(prompt).toContain('语言: typescript')
      expect(prompt).toContain('包管理器: pnpm')
      expect(prompt).toContain('框架: express, vitest')
      // 目录结构已被注释，不再输出
      // expect(prompt).toContain('## 目录结构')
      expect(prompt).toContain('## 可用脚本')
      expect(prompt).toContain('pnpm run build')
    })

    it('should include CLAUDE.md content', () => {
      const context: ProjectContext = {
        projectType: 'nodejs',
        mainLanguage: 'typescript',
        frameworks: [],
        directoryStructure: '',
        keyFiles: [],
        scripts: {},
        claudeMdContent: '# 项目规范\n请使用 TypeScript',
      }

      const prompt = formatProjectContextForPrompt(context)

      expect(prompt).toContain('## 项目规范 (CLAUDE.md)')
      expect(prompt).toContain('请使用 TypeScript')
    })

    it('should truncate long CLAUDE.md content', () => {
      const longContent = 'x'.repeat(2000)
      const context: ProjectContext = {
        projectType: 'nodejs',
        mainLanguage: 'typescript',
        frameworks: [],
        directoryStructure: '',
        keyFiles: [],
        scripts: {},
        claudeMdContent: longContent,
      }

      const prompt = formatProjectContextForPrompt(context)

      expect(prompt).toContain('...(截断)')
      expect(prompt.length).toBeLessThan(longContent.length)
    })
  })
})
