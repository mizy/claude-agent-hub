import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/cli/index.ts',
    'src/task/runQueueProcess.ts',
    'src/task/runTaskProcess.ts',
  ],
  format: ['esm'],
  outDir: 'dist',
  dts: false, // 常规构建不生成类型声明，加快构建速度
  sourcemap: true,
  clean: true,
  target: 'node18',
  splitting: false, // 禁用代码分割，避免 hash chunk 导致热重载问题
  // 构建后执行 chmod +x（dashboard 由 vite 单独构建到 dist/server/public/）
  onSuccess: 'chmod +x dist/cli/index.js',
})
