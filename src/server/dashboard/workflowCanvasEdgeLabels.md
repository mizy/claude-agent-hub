# Workflow Canvas Edge Labels

**概述**

本次优化统一了 workflow canvas edge label 的语义和视觉表达，让开发者可以更快区分分支类型与运行状态，并减少样式与渲染结构漂移带来的回退风险。

**快速开始**

本地验证这组改动，按下面顺序执行即可：

```bash
pnpm run typecheck
pnpm exec tsc -p src/server/dashboard/tsconfig.json --noEmit
pnpm exec vitest run src/server/dashboard/components/workflowToSchema.test.ts
pnpm --dir src/server/dashboard run build
pnpm test
```

浏览器验收入口：

- 打开 http://localhost:7788
- 进入任意带 condition 或 loop 的 workflow
- 重点检查 if、if not、else、loop 以及 pending、running、completed、failed 几类 edge label

**核心概念**

- 状态语义与分支语义分离。状态负责回答这条边现在处于什么阶段，分支类型负责回答这条边为什么存在。
- edge label 统一采用 pill 视觉，不再让 positive 或 negative condition 抢占主色，主视觉始终由状态驱动。
- loop 只保留虚线边框强化结构语义，不再单独改变整套主色。
- tooltip 同步展示 branch kind、status、label 和完整 condition，降低排障成本。

**参考**

最终视觉方案：

- 统一为深色半透明 pill，字号 11px，字重 600，圆角 10px，带 1px 边框和轻微阴影
- pending 使用低饱和深色底，适合表达未命中或未执行分支
- running 使用蓝色边框与 glow，强调当前活跃链路
- completed 使用绿色边框与 glow，强化成功完成感知
- failed 使用红色边框与 glow，优先暴露异常链路
- condition、else、loop 统一复用同一套 pill 基座，只通过 label kind 补充结构语义

涉及文件：

- src/server/dashboard/components/workflowToSchema.ts
  统一输出 label、labelKind、status，并收紧 edge 状态推断优先级
- src/server/dashboard/components/WorkflowCanvas.tsx
  补充 edge hover tooltip 信息
- src/server/dashboard/styles/workflow.css
  实现统一 pill 样式，并修正选择器以命中当前 ve DOM 结构
- src/server/dashboard/components/workflowToSchema.test.ts
  锁定 condition、else、loop 与状态类名的回归测试
- src/server/dashboard/components/ChatPage.tsx
  修复 dashboard 现有类型问题，保证前端验证链路可执行
- src/server/dashboard/vite-env.d.ts
  补充 Vite 环境类型声明

验证命令结果：

- 通过：pnpm run typecheck
- 通过：pnpm exec tsc -p src/server/dashboard/tsconfig.json --noEmit
- 通过：pnpm exec vitest run src/server/dashboard/components/workflowToSchema.test.ts
- 通过：pnpm --dir src/server/dashboard run build
- 通过：pnpm test
- 说明：dashboard build 仍有大 bundle warning，但不影响本次功能、类型或构建结论

浏览器截图验收结论：

- 已确认 localhost:7788 可访问，并完成 workflow 页面截图审查
- 修复前，edge label 大面积退回默认白底黑字，说明样式未命中真实 DOM
- 修复后，if、else、loop 已稳定呈现 pill 背景、描边、状态色与虚线语义
- 当前截图未见明显的对比度不足、遮挡、文字溢出或布局回退
- 本轮视觉验收结论为通过，可作为当前默认方案继续迭代

**常见问题**

- 为什么标签会退回白底黑字？
  常见原因是样式选择器与实际渲染 DOM 结构不一致，或浏览器仍在读取旧的 dashboard 构建产物。

- 为什么未执行的 else 或 condition 分支显示为 pending？
  这是刻意保留的 unreached 语义，用来区分真正走过的 completed 分支与尚未命中的备用路径。

- 为什么 loop 不再使用单独主色？
  loop 是结构信息，不应压过运行状态。当前方案只保留虚线边框，避免与 completed 或 failed 语义冲突。

**后续优先方向**

- 优先处理高密度 workflow 下的 label 遮挡与重叠，尤其是多条件汇聚和回环同时出现的场景
- 优先补一组浏览器级视觉回归样例，覆盖 running、failed、skipped 与缩放场景，减少后续升级编辑器 DOM 结构时的样式漂移风险
