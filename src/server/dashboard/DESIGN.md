# Dashboard React 重构设计文档

## 1. 现有架构分析

### 1.1 当前实现 (单文件 index.html, ~2000 行)

所有逻辑集中在 `src/server/public/index.html`，纯 vanilla JS + Canvas 渲染，通过 CDN 加载 `marked.js`。

### 1.2 后端 API (`src/server/createServer.ts`)

Express 5 服务，提供以下 API：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/tasks` | GET | 任务列表（按时间倒序） |
| `/api/tasks` | POST | 创建新任务 `{description, priority}` |
| `/api/tasks/:id` | GET | 任务详情（task + workflow + instance） |
| `/api/tasks/:id` | DELETE | 删除任务 |
| `/api/tasks/:id/stop` | POST | 停止任务 |
| `/api/tasks/:id/resume` | POST | 恢复任务 |
| `/api/tasks/:id/complete` | POST | 完成任务 |
| `/api/tasks/:id/timeline` | GET | 事件时间线 |
| `/api/tasks/:id/logs` | GET | 执行日志（支持 `?tail=N`） |
| `/api/tasks/:id/result` | GET | 结果 Markdown |
| `/api/summary` | GET | 实时摘要 |

静态文件服务：`express.static(publicDir)` + SPA fallback 到 `index.html`。

### 1.3 功能模块清单

**A. 左侧栏 - 任务列表 (Sidebar)**
- 任务列表展示（标题、状态标签、创建时间）
- 任务选中高亮
- 任务操作按钮（Stop/Resume/Complete/Delete）
- 新建任务按钮 + Modal
- 删除确认 Modal

**B. 中间区域 - 工作流画布 (Workflow Canvas)**
- Canvas 2D 渲染工作流节点和边
- 拓扑排序自动布局（支持 loop 节点和 body 子节点）
- 节点状态颜色（pending/running/done/failed/skipped）
- 节点选中高亮
- 鼠标/触摸拖拽平移
- 鼠标滚轮/触摸捏合缩放（支持 trackpad pinch）
- Fit-to-view 自适应
- 平滑动画过渡（ease-out cubic）
- 节点悬浮 Tooltip
- 状态图例 + 缩放控制工具栏

**C. 右侧面板 - 详情/日志/输出 (Right Panel)**
- Tab 切换：Details / Timeline / Logs / Output
- Details Tab：选中节点详情（状态、类型、尝试次数、耗时、错误、输出）或工作流摘要（节点统计、变量、失败节点）
- Timeline Tab：事件时间线日志
- Logs Tab：执行日志文件查看器（支持 tail + 刷新）
- Output Tab：result.md Markdown 渲染（marked.js）或节点输出 fallback

**D. 全局功能**
- 3 秒自动轮询刷新
- Toast 通知
- 响应式布局：桌面三栏 / 平板折叠右面板 / 手机侧边栏滑出
- 键盘快捷键（Esc 关闭 Modal，Cmd+Enter 提交）
- 深色主题（Slate 色系）

---

## 2. React + Vite 技术方案

### 2.1 技术栈选型

| 选择 | 原因 |
|------|------|
| **Vite** | 快速 dev server，开箱即用 React 支持，构建输出可直接作为静态文件 |
| **React 19** | 组件化拆分，声明式 UI |
| **TypeScript** | 与主项目一致 |
| **zustand** | 轻量状态管理（< 2KB），无 Provider，API 简洁 |
| **Canvas 2D** | 沿用现有渲染方式，不引入额外图形库 |
| **marked** | 沿用现有 Markdown 渲染依赖（主项目已有） |

**不引入的库**：React Flow/dagre（现有布局逻辑够用）、TailwindCSS（保持 CSS 简单，用 CSS Modules）

### 2.2 目录结构

```
src/server/dashboard/           # React 应用源码
├── DESIGN.md                   # 本文档
├── index.html                  # Vite 入口 HTML
├── main.tsx                    # React 入口
├── App.tsx                     # 根组件（三栏布局）
├── store/
│   └── useStore.ts             # zustand store（tasks, selectedTaskId, taskData 等）
├── api/
│   └── fetchApi.ts             # API 请求封装（fetch wrapper）
├── components/
│   ├── Sidebar.tsx             # 左侧任务列表
│   ├── TaskItem.tsx            # 单个任务条目
│   ├── WorkflowCanvas.tsx      # Canvas 工作流渲染（含 pan/zoom）
│   ├── RightPanel.tsx          # 右侧面板容器 + Tab 切换
│   ├── DetailsTab.tsx          # 详情 Tab
│   ├── TimelineTab.tsx         # 时间线 Tab
│   ├── LogsTab.tsx             # 执行日志 Tab
│   ├── OutputTab.tsx           # 输出 Tab（Markdown 渲染）
│   ├── NewTaskModal.tsx        # 新建任务弹窗
│   ├── DeleteConfirmModal.tsx  # 删除确认弹窗
│   └── Toast.tsx               # Toast 通知
├── hooks/
│   ├── useAutoRefresh.ts       # 3s 轮询 hook
│   └── usePanZoom.ts           # Canvas 拖拽/缩放 hook
├── lib/
│   ├── layoutNodes.ts          # 拓扑排序布局算法
│   ├── drawWorkflow.ts         # Canvas 绘制逻辑
│   └── constants.ts            # 颜色/尺寸常量
└── styles/
    └── global.css              # 全局样式（深色主题基础）
```

### 2.3 状态管理 (zustand)

```ts
interface DashboardStore {
  // Task list
  tasks: Task[]
  selectedTaskId: string | null

  // Selected task data
  taskData: { task: Task; workflow: Workflow; instance: Instance } | null
  timelineLogs: TimelineEvent[]

  // UI state
  selectedNodeId: string | null
  activeTab: 'details' | 'logs' | 'exec-logs' | 'output'
  sidebarOpen: boolean      // mobile
  rightPanelOpen: boolean   // mobile

  // Actions
  selectTask: (id: string) => void
  selectNode: (id: string | null) => void
  setActiveTab: (tab: string) => void
  refreshTasks: () => void
  refreshTaskData: () => void
}
```

### 2.4 Canvas 渲染策略

**保持 Canvas 2D**：将现有的 `calculateNodePositions` 和 `renderWorkflow` 提取到 `layoutNodes.ts` 和 `drawWorkflow.ts`，在 React 中通过 `useRef` + `useEffect` 控制 Canvas 重绘。

Pan/Zoom 逻辑抽取为 `usePanZoom` hook，返回 `{ panX, panY, scale, bindEvents }` 供 Canvas 组件使用。

### 2.5 构建与集成

**Vite 配置**：
```ts
// src/server/dashboard/vite.config.ts
export default defineConfig({
  root: 'src/server/dashboard',
  build: {
    outDir: '../../../dist/server/public',  // 输出到构建目录
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',  // 开发代理
    },
  },
})
```

**构建流程**：
1. `pnpm run build:dashboard` — Vite 构建 React 应用到 `dist/server/public/`
2. `pnpm run build` — tsup 构建主项目（不包含 dashboard 源码）
3. 生产模式：Express 直接 serve `dist/server/public/` 下的静态文件

**开发模式**：
- `pnpm run dev:dashboard` — Vite dev server（端口 5173），API 代理到 Express（端口 3000）
- 或同时运行 `cah serve` + `vite dev`

**package.json 新增 scripts**：
```json
{
  "build:dashboard": "vite build --config src/server/dashboard/vite.config.ts",
  "dev:dashboard": "vite --config src/server/dashboard/vite.config.ts"
}
```

### 2.6 后端兼容

**无需修改 createServer.ts**：
- API 路由完全不变
- 静态文件目录 `dist/server/public/` 不变
- SPA fallback 已支持
- CORS 已开启（开发代理时也兼容）

唯一变化：`src/server/public/index.html` 从手写变为 Vite 构建产物。开发期间保留旧文件作为参照，React 版本完成后替换。

### 2.7 迁移策略

分步实施，每步可独立验证：

1. **脚手架搭建**：创建 Vite + React 项目骨架，配置构建输出和开发代理
2. **基础布局**：App 三栏布局 + 响应式 + 深色主题样式
3. **状态管理 + API**：zustand store + fetchApi + 自动轮询
4. **左侧栏**：TaskList + TaskItem + NewTaskModal + DeleteConfirmModal
5. **Canvas 画布**：WorkflowCanvas + layoutNodes + drawWorkflow + usePanZoom
6. **右侧面板**：四个 Tab 组件 + Markdown 渲染
7. **全局功能**：Toast、键盘快捷键、responsive toggle
8. **验证与替换**：功能对比测试，构建产物替换旧 index.html

---

## 3. 关键设计决策

### 为什么 zustand 而非 React Context？
- Context 导致 Provider 嵌套，且每次状态变化会引起所有消费者重渲染
- zustand 精确订阅，Canvas 重绘不会触发整个面板更新
- API 更简单，无需 useReducer

### 为什么保留 Canvas 2D 而非 React Flow？
- 现有 Canvas 渲染逻辑成熟（布局、箭头、loop 节点、动画）
- React Flow 会引入大量依赖（dagre/elkjs），打包体积大
- Canvas 性能好，适合频繁重绘（拖拽/缩放/轮询更新）
- 迁移成本低：直接复用现有绘制代码

### 为什么不用 TailwindCSS？
- Dashboard 样式量不大，CSS Modules 足够
- 避免额外构建配置和依赖
- 现有样式可直接复用

---

## 4. 新增依赖

```
dependencies (dashboard):
  react@^19
  react-dom@^19
  zustand@^5
  marked@^17 (已有)

devDependencies:
  @vitejs/plugin-react
  vite
  @types/react
  @types/react-dom
```
