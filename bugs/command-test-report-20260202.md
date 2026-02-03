# CAH 命令测试报告

**测试时间**: 2026-02-02 17:47-17:49
**测试环境**: Node.js v22.12.0, npm 10.9.0
**CAH 版本**: 0.1.0

---

## 测试概览

| 命令 | 状态 | 响应时间 | 备注 |
|------|------|----------|------|
| `cah "描述" --no-run` | ✅ 通过 | 0.33s | 任务创建成功 |
| `cah task list` | ✅ 通过 | 0.35s | 列表显示正常 |
| `cah task logs <id>` | ⚠️ 部分问题 | 0.53s | 见 Bug #1 |
| `cah template suggest` | ✅ 通过 | 0.40s | 推荐逻辑正常 |
| `cah template ranking` | ⚠️ 数据异常 | 0.37s | 见 Bug #2 |
| `cah report trend` | ✅ 通过 | 0.39s | 报告生成正常 |
| `cah report live` | ✅ 通过 | 0.47s | 实时监控正常 |

---

## 发现的 Bug

### Bug #1: `cah task logs` 不支持 `--tail` 参数

**严重程度**: 中等
**类型**: 功能缺失

**复现步骤**:
```bash
cah task logs task-20260202-174640-weh --tail 20
```

**预期行为**:
显示最后 20 行日志

**实际行为**:
```
error: unknown option '--tail'
Exit code 1
```

**分析**:
- `cah task logs` 命令未实现 `--tail` 参数
- 对于长日志文件，无法快速查看最新内容
- 需要依赖外部工具（如 `head`）来截取日志

**建议修复**:
在 `src/cli/commands/task.ts` 的 logs 子命令中添加 `--tail <n>` 选项，限制输出行数。

**影响范围**:
- 日志查看体验
- 大型任务的日志浏览效率

**相关文件**:
- `src/cli/commands/task.ts` (logs 子命令定义)

---

### Bug #2: `cah template ranking` 显示大量重复的测试模板

**严重程度**: 高
**类型**: 数据污染 / 清理逻辑缺失

**复现步骤**:
```bash
cah template ranking
```

**预期行为**:
显示有意义的、唯一的模板排行榜

**实际行为**:
排行榜中充斥着 70+ 个名为 "Test template" 的 `count-test-*` 模板，都是 50% 有效性（1 成功/1 失败），严重降低了排行榜的可读性和实用性。

**输出示例**:
```
3. count-test-ml3qfpb2  Test template  50% (1成功/1失败, 共2次)
4. count-test-ml3qh0cp  Test template  50% (1成功/1失败, 共2次)
5. count-test-ml3qho6q  Test template  50% (1成功/1失败, 共2次)
...
74. fix-bug  修复 Bug  33% (71成功/142失败, 共213次)
```

**根本原因分析**:
1. **测试模板未被清理**: 开发/测试过程中创建的临时模板 (`count-test-*`) 未被删除
2. **缺少过滤机制**: 排行榜逻辑未过滤掉低置信度或测试模板
3. **命名冲突**: 大量模板使用相同的 "Test template" 标题

**影响范围**:
- 用户体验严重受损
- 无法快速找到真正有价值的模板
- 模板推荐质量下降

**建议修复方案**:

#### 方案 1: 添加模板清理命令（推荐）
```bash
# 清理低置信度模板（执行次数 < 5）
cah template clean --min-count 5

# 清理测试模板（按前缀）
cah template clean --pattern "count-test-*"

# 清理所有无效模板（有效性 < 30%）
cah template clean --min-effectiveness 0.3
```

实现位置：`src/cli/commands/template.ts` 添加 `clean` 子命令

#### 方案 2: 改进排行榜过滤逻辑
在 `src/report/TemplateRanking.ts` 或相关文件中：
- 只显示执行次数 >= 5 的模板
- 排除以 `count-test-`, `test-` 等前缀的模板
- 添加 `--show-all` 参数来显示完整列表

#### 方案 3: 自动归档机制
- 自动将低置信度模板移至 `.cah-data/templates/archived/`
- 在 template ranking 中默认隐藏归档模板
- 提供 `--include-archived` 参数查看

**相关文件**:
- `src/template/TemplateCore.ts` (模板存储逻辑)
- `src/template/TemplateScoring.ts` (评分和过滤)
- `src/cli/commands/template.ts` (命令行接口)

---

## 其他观察

### 正向反馈

1. **任务恢复机制工作良好**
   - 检测到中断任务并自动提示恢复
   - 恢复流程清晰可见（显示 PID 和状态）

2. **进度显示直观**
   - 任务列表中的进度条和百分比清晰
   - ETA 预估功能正常工作

3. **命令响应速度快**
   - 所有命令响应时间 < 1s
   - 用户体验流畅

### 潜在改进点

1. **任务列表显示**
   - 标题过长时被截断（`...`），可考虑添加 `--full` 参数显示完整标题
   - 或者使用 `cah task list --verbose` 显示详细信息

2. **日志查看体验**
   - 缺少 `--tail`, `--follow` 等常用参数
   - 建议参考 `journalctl` 或 `docker logs` 的参数设计

3. **模板推荐精度**
   - 当前推荐基于类型匹配和历史有效性
   - 可以考虑引入语义相似度匹配（如使用 embedding）

---

## 优先级建议

### P0 - 必须修复
- Bug #2: 清理测试模板数据污染

### P1 - 高优先级
- Bug #1: 添加 `--tail` 参数支持

### P2 - 优化体验
- 任务列表完整标题显示
- 日志查看增强（`--follow`, `--since` 等）

---

## 测试数据

### 任务创建测试
```bash
$ time cah "测试任务 - 命令功能验证" --no-run
✓ Created task: 测试任务 - 命令功能验证
  ID: task-20260202-174810-w7c
ℹ Task created (--no-run). Use "cah run" or "cah task resume" to execute.

Real: 0.329s
User: 0.40s
System: 0.12s
CPU: 158%
```

### 任务列表测试
```bash
$ time cah task list
╔════════════════╤═══════════════════════════╤═════════╤═══════╤═════╤════════╗
║ ID             │ 标题                      │ 状态    │ 进度  │ PID │ 优先级 ║
╟────────────────┼───────────────────────────┼─────────┼───────┼─────┼────────╢
║ task-...w7c    │ 测试任务 - 命令功能验证   │ pending │ -     │ -   │ medium ║
║ task-...weh    │ 测试下我们的 CAH 命令...  │ develop │ 20%   │ 3135│ medium ║
╚════════════════╧═══════════════════════════╧═════════╧═══════╧═════╧════════╝

Real: 0.351s
User: 0.43s
System: 0.12s
CPU: 154%
```

### 模板推荐测试
```bash
$ time cah template suggest "测试功能"
  推荐模板 (基于: "测试功能")

  1. write-unit-tests [有效性: 75%]
     编写单元测试
     匹配度: ████░░░░░░ 36
     原因: 类型匹配: test; 有效性评分: 75%

  2. implement-feature [有效性: 100%]
     实现新功能
     匹配度: ███░░░░░░░ 25
     原因: 有效性评分: 100%; 使用142次

  ...

Real: 0.400s
User: 0.43s
System: 0.15s
CPU: 145%
```

---

## 结论

核心命令功能基本正常，主要问题集中在：
1. 数据清理机制缺失（测试模板污染）
2. 日志查看功能待增强（缺少常用参数）

建议优先处理模板清理问题，以恢复 `cah template ranking` 的实用性。
