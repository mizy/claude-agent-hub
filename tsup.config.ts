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
  // 构建后执行 chmod +x 并复制静态文件
  onSuccess: 'chmod +x dist/cli/index.js && mkdir -p dist/server/public && cp -r src/server/public/* dist/server/public/',
})
