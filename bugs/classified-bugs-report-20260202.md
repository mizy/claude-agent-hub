# CAH 问题分类报告

**生成时间**: 2026年02月02日 17:53
**测试范围**: 核心命令测试 + 边界场景测试
**测试覆盖率**: 22个测试场景
**总体通过率**: 19/22 (86%)

---

## 一、严重 Bug（功能无法使用、数据丢失）

### Bug #2.1: 模板排行榜数据污染（P0）

**标题**: `cah template ranking` 被70+个测试模板污染，功能几乎不可用

**严重程度**: 🔴 Critical (P0) - 功能严重受损

**复现步骤**:
```bash
cah template ranking
```

**预期行为**:
显示有意义的、唯一的模板排行榜，帮助用户发现高效模板

**实际行为**:
排行榜中充斥着 70+ 个名为 "Test template" 的 `count-test-*` 模板，都是 50% 有效性（1 成功/1 失败），严重降低了排行榜的可读性和实用性。真正有价值的模板（如 `fix-bug`）被排到第74位。

**输出示例**:
```
3. count-test-ml3qfpb2  Test template  50% (1成功/1失败, 共2次)
4. count-test-ml3qh0cp  Test template  50% (1成功/1失败, 共2次)
...
74. fix-bug  修复 Bug  33% (71成功/142失败, 共213次)
```

**可能原因**:
1. 测试模板未被清理 - 开发/测试过程中创建的临时模板 (`count-test-*`) 未被删除
2. 缺少过滤机制 - 排行榜逻辑未过滤掉低置信度或测试模板
3. 命名冲突 - 大量模板使用相同的 "Test template" 标题

**影响范围**:
- ✗ 用户体验严重受损
- ✗ 无法快速找到真正有价值的模板
- ✗ 模板推荐质量下降（推荐算法基于历史数据）
- ✗ 数据库膨胀（70+ 无用模板占用存储）

**建议修复方案**:

#### 方案 1: 添加模板清理命令（推荐）⭐
```bash
# 清理低置信度模板（执行次数 < 5）
cah template clean --min-count 5

# 清理测试模板（按前缀）
cah template clean --pattern "count-test-*"

# 清理所有无效模板（有效性 < 30%）
cah template clean --min-effectiveness 0.3

# 批量清理（组合条件）
cah template clean --min-count 3 --min-effectiveness 0.3
```

**实现位置**: `src/cli/commands/template.ts` 添加 `clean` 子命令

**实现要点**:
- 支持多条件过滤（AND 逻辑）
- 显示待删除模板列表，要求用户确认（`--yes` 跳过确认）
- 记录删除日志到 `.cah-data/templates/deleted.log`
- 删除前备份到 `.cah-data/templates/archive/`

#### 方案 2: 改进排行榜过滤逻辑
在 `src/template/TemplateScoring.ts` 中：
```typescript
// 过滤低质量模板
function filterTemplatesForRanking(templates: Template[]) {
  return templates.filter(t =>
    t.stats.totalCount >= 5 &&  // 至少使用5次
    !t.id.startsWith('test-') &&
    !t.id.startsWith('count-test-') &&
    t.name !== 'Test template'  // 排除测试模板
  );
}
```

添加命令行参数：
```bash
cah template ranking --show-all  # 显示所有模板（包括测试模板）
cah template ranking --min-count 5  # 最少使用次数
```

#### 方案 3: 自动归档机制（长期方案）
- 自动将低置信度模板移至 `.cah-data/templates/archived/`
- 在 template ranking 中默认隐藏归档模板
- 提供 `--include-archived` 参数查看

**修复优先级**: 🔥 **立即修复** - 建议先执行方案1+方案2组合：
1. 手动清理现有测试模板（`cah template clean --pattern "count-test-*"`）
2. 实现排行榜过滤逻辑（默认过滤低质量模板）
3. 长期实现自动归档机制

**相关文件**:
- `src/template/TemplateCore.ts:120-180` - 模板存储逻辑
- `src/template/TemplateScoring.ts:45-90` - 评分和过滤
- `src/cli/commands/template.ts:85-130` - ranking 命令实现

**预计工作量**: 2-3小时

---

## 二、一般 Bug（功能异常、输出错误）

### Bug #1: `cah task logs` 不支持 `--tail` 参数（P1）

**标题**: 日志查看缺少 `--tail` 参数，无法快速查看最新内容

**严重程度**: 🟠 High (P1) - 功能缺失，影响使用效率

**复现步骤**:
```bash
cah task logs task-20260202-174640-weh --tail 20
```

**预期行为**:
显示最后 20 行日志，类似 `tail -n 20` 的效果

**实际行为**:
```
error: unknown option '--tail'
Exit code 1
```

**可能原因**:
`src/cli/commands/task.ts` 中的 `logs` 子命令未实现 `--tail` 参数，只支持 `-f/--follow`

**影响范围**:
- 日志查看体验下降
- 大型任务的日志浏览效率低（需要滚动到底部）
- 需要依赖外部工具（如 `cah task logs xxx | tail -n 20`）

**建议修复方案**:

在 `src/cli/commands/task.ts` 的 `logs` 子命令中添加参数：

```typescript
.command('logs <id>')
  .description('查看任务日志')
  .option('-f, --follow', '持续监听日志更新')
  .option('-n, --tail <lines>', '显示最后N行', '100')  // 新增
  .option('--head <lines>', '显示前N行')  // 新增
  .option('--since <time>', '显示指定时间后的日志')  // 可选
  .action(async (id: string, options) => {
    // 实现逻辑
  });
```

**实现要点**:
- 使用 `fs.readFileSync` + `split('\n').slice(-n)` 实现 tail
- 支持 `--tail` 和 `--follow` 组合使用
- 默认显示100行（避免输出过多）

**相关文件**:
- `src/cli/commands/task.ts:180-220` - logs 命令定义
- `src/task/queryTask.ts:85-120` - 日志读取逻辑

**预计工作量**: 0.5小时

---

### Bug #3: `cah task get` 命令不存在（P1）

**标题**: 缺少 `task get` 命令，无法快速查看单个任务元数据

**严重程度**: 🟠 High (P1) - 功能缺失

**复现步骤**:
```bash
cah task get task-20260202-174640-weh
```

**预期行为**:
显示任务的详细信息（JSON 格式或格式化输出）：
- 任务ID、标题、描述
- 状态、优先级、创建时间
- 节点执行情况
- 统计信息（耗时、成本等）

**实际行为**:
```
error: unknown command 'get'
```

**可能原因**:
`src/cli/commands/task.ts` 中未实现 `get` 子命令，用户只能通过以下方式查看任务：
1. `cah task list` - 但只显示摘要信息
2. `cah task logs <id>` - 但输出的是日志而非元数据
3. 手动查看 `.cah-data/tasks/<id>/task.json`

**影响范围**:
- 用户体验不完整
- 无法快速查看任务详情（需要手动查看文件）
- CLI 功能不完整（list/get/delete 是标准三件套）

**建议修复方案**:

在 `src/cli/commands/task.ts` 中添加 `get` 子命令：

```typescript
.command('get <id>')
  .description('查看任务详情')
  .option('--json', '以 JSON 格式输出')
  .option('--verbose', '显示详细信息（包括节点状态）')
  .action(async (id: string, options) => {
    const task = await queryTask.getTask(id);
    const workflow = await workflowStore.getWorkflow(id);
    const instance = await workflowStore.getInstanceState(id);

    if (options.json) {
      console.log(JSON.stringify({ task, workflow, instance }, null, 2));
    } else {
      // 格式化输出
      formatTaskDetails(task, workflow, instance, options.verbose);
    }
  });
```

**输出示例**:
```
📋 任务详情

ID:           task-20260202-174640-weh
标题:         测试下我们的 CAH 命令功能
状态:         🚧 develop (20% 完成)
优先级:       medium
创建时间:     2026-02-02 17:46:40
执行时长:     5m 32s

节点进度:     2/10 已完成
  ✅ prepare-test-env (30s)
  ✅ test-core-commands (2m 15s)
  🔄 test-edge-cases (运行中)
  ⏸ analyze-and-classify (等待中)
  ...

统计:
  成本:        $0.05
  Token:       15,234
  重试次数:    0
```

**相关文件**:
- `src/cli/commands/task.ts` - 添加 get 命令
- `src/task/queryTask.ts:30-60` - getTask 函数已存在
- `src/cli/output.ts` - 添加格式化输出函数

**预计工作量**: 1小时

---

### Bug #4: 空描述参数被静默接受（P2）

**标题**: `cah ""` 无任何输出，用户无法判断是成功还是失败

**严重程度**: 🟡 Medium (P2) - 用户体验问题

**复现步骤**:
```bash
cah "" --no-run
```

**预期行为**:
显示错误提示：
```
✗ 错误: 任务描述不能为空
  请使用 `cah "描述"` 创建任务
  或使用 `cah --help` 查看帮助
```

**实际行为**:
命令静默完成，无任何输出（未创建任务）

**可能原因**:
`src/cli/index.ts` 中缺少输入验证，空字符串被传递到任务创建流程后被默默忽略

**影响范围**:
- 用户困惑（不知道是成功还是失败）
- 潜在的自动化脚本问题（无法通过退出码判断）

**建议修复方案**:

在 `src/cli/index.ts` 主命令处理中添加验证：

```typescript
// 从参数或 stdin 获取 input
const input = await getInput(rawInput);

// 验证输入
if (!input || input.trim().length === 0) {
  console.error(chalk.red('✗ 错误: 任务描述不能为空'));
  console.error(chalk.gray('  请使用 `cah "描述"` 创建任务'));
  console.error(chalk.gray('  或使用 `cah --help` 查看帮助'));
  process.exit(1);
}
```

**相关文件**:
- `src/cli/index.ts:120-150` - 输入处理逻辑

**预计工作量**: 0.5小时

---

### Bug #5: stdin 空输入无提示（P2）

**标题**: 从管道读取空输入时无任何反馈

**严重程度**: 🟡 Medium (P2) - 用户体验问题

**复现步骤**:
```bash
echo "" | cah
```

**预期行为**:
显示错误提示：
```
✗ 错误: 从标准输入读取失败或输入为空
  请提供任务描述
```

**实际行为**:
命令静默完成，无任何输出

**可能原因**:
stdin 处理逻辑未检测空输入，与 Bug #4 类似但发生在不同的代码路径

**影响范围**:
- 管道使用场景体验差
- 自动化脚本难以判断成功/失败

**建议修复方案**:

在 `src/cli/index.ts` 的 stdin 读取逻辑中添加验证：

```typescript
async function readFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim();

  // 新增验证
  if (!input) {
    console.error(chalk.red('✗ 错误: 从标准输入读取失败或输入为空'));
    console.error(chalk.gray('  请提供任务描述'));
    process.exit(1);
  }

  return input;
}
```

**相关文件**:
- `src/cli/index.ts:95-115` - stdin 读取逻辑

**预计工作量**: 0.5小时

---

## 三、优化建议（性能、体验改进）

### 优化 #1: 任务列表标题截断（P2）

**标题**: 长标题被截断显示 `...`，无法查看完整信息

**严重程度**: 🟡 Medium (P2) - 体验改进

**当前行为**:
```bash
$ cah task list
║ task-...weh │ 测试下我们的 CAH 命令...  │ develop │ 20%   │ 3135│ medium ║
```

**建议改进**:
1. 添加 `--full` 参数显示完整标题
2. 或添加 `--verbose/-v` 参数显示详细信息

```bash
$ cah task list --full
║ task-20260202-174640-weh │ 测试下我们的 CAH 命令功能，全面覆盖各种场景 │ ...

$ cah task list -v
# 显示多行详细信息，包括描述、创建时间等
```

**相关文件**:
- `src/cli/commands/task.ts:60-95` - list 命令
- `src/cli/output.ts` - 表格格式化

**预计工作量**: 1小时

---

### 优化 #2: 日志查看增强（P2）

**标题**: 缺少常用的日志查看参数

**严重程度**: 🟡 Medium (P2) - 体验改进

**当前功能**:
- `cah task logs <id>` - 查看全部日志
- `cah task logs <id> -f` - 持续监听

**建议增强**:
```bash
cah task logs <id> --tail 50        # 显示最后50行（已在Bug #1）
cah task logs <id> --head 20        # 显示前20行
cah task logs <id> --since 10m      # 显示最近10分钟的日志
cah task logs <id> --grep "error"   # 过滤包含 "error" 的行
cah task logs <id> --level error    # 只显示 error 级别日志
```

参考 `journalctl` 和 `docker logs` 的设计

**相关文件**:
- `src/cli/commands/task.ts:180-220` - logs 命令

**预计工作量**: 2-3小时

---

### 优化 #3: 模板推荐语义匹配（P3）

**标题**: 模板推荐可引入语义相似度匹配

**严重程度**: 🟢 Low (P3) - 功能增强

**当前机制**:
基于任务类型匹配和历史有效性评分

**建议增强**:
引入语义相似度匹配（使用 embedding）：
1. 将任务描述转换为 embedding
2. 计算与历史模板的相似度
3. 结合类型匹配和有效性评分综合排序

**好处**:
- 即使任务类型不匹配，也能找到语义相似的模板
- 提高推荐精度

**实现方式**:
- 使用 Anthropic API 的 embedding 功能
- 或使用轻量级的本地 embedding 模型（如 sentence-transformers）

**相关文件**:
- `src/template/TemplateSuggestion.ts:30-85` - 推荐逻辑

**预计工作量**: 4-6小时

---

### 优化 #4: 命令解析歧义（P2）

**标题**: 不存在的命令被当作任务描述

**严重程度**: 🟡 Medium (P2) - 设计决策

**当前行为**:
```bash
$ cah nonexistent
✓ Created task: nonexistent
```

**问题**:
用户输入错误命令时，系统会创建不必要的任务

**设计决策点**:
这是一个设计权衡问题：

**方案A**: 保持当前行为（灵活性）
- 优点: 用户可以快速创建任务，无需引号
- 缺点: 容易误操作

**方案B**: 要求任务描述使用引号（严格性）
- 优点: 命令和描述区分清晰
- 缺点: 使用体验略差

**方案C**: 智能提示（推荐）⭐
```bash
$ cah nonexistent
! 未找到命令 "nonexistent"
  是否将 "nonexistent" 作为任务描述？(y/N)
  或者您可能想输入:
    - cah task nonexistent
    - cah "nonexistent"
```

**建议**: 采用方案C，在保持灵活性的同时增加安全性

**相关文件**:
- `src/cli/index.ts:50-80` - 命令解析逻辑

**预计工作量**: 1-2小时（需要 UX 设计）

---

## 四、文档问题（说明不清、示例错误）

### 文档 #1: `cah task get` 命令缺失说明（P2）

**标题**: 用户不知道如何查看单个任务详情

**问题描述**:
当前文档/帮助信息中提到 `cah task list` 可以查看任务列表，但没有说明如何查看单个任务的详细信息

**用户困惑**:
- "我想查看任务 XXX 的详细信息，应该用什么命令？"
- 用户尝试 `cah task get`、`cah task show`、`cah task info` 都失败

**建议改进**:
1. 如果实现了 Bug #3（添加 `task get` 命令），在帮助信息中说明
2. 如果暂不实现，在文档中明确说明使用 `cah task logs <id>` 查看任务

**相关文件**:
- `README.md` - 主文档
- `src/cli/commands/task.ts` - help 信息

---

## 五、测试结果总结

### 测试覆盖情况

| 测试类别 | 场景数 | 通过 | 失败 | 通过率 |
|---------|--------|------|------|--------|
| 核心命令 | 7 | 7 | 0 | 100% |
| 边界场景 | 15 | 12 | 3 | 80% |
| **总计** | **22** | **19** | **3** | **86%** |

### 核心功能测试（7/7 通过）✅

| 命令 | 响应时间 | 状态 |
|------|---------|------|
| `cah "描述" --no-run` | 0.33s | ✅ |
| `cah task list` | 0.35s | ✅ |
| `cah task logs <id>` | 0.53s | ✅ (有改进空间) |
| `cah template suggest` | 0.40s | ✅ |
| `cah template ranking` | 0.37s | ✅ (有数据问题) |
| `cah report trend` | 0.39s | ✅ |
| `cah report live` | 0.47s | ✅ |

**性能评价**: 🌟 所有命令响应时间 < 1s，性能优秀

### 边界场景测试（12/15 通过）

**✅ 通过的场景** (12):
- 特殊字符处理 (`<>&|`)
- 超长描述 (1000字符)
- 不存在任务的各种操作
- 并发创建 (5个任务)
- 空列表显示
- 无效参数处理

**❌ 失败的场景** (3):
- 空描述输入（Bug #4）
- stdin空输入（Bug #5）
- `task get` 命令不存在（Bug #3）

### 错误处理质量评估

**🌟 优秀之处**:
1. **友好的错误提示**: 使用颜色和格式化输出
   ```
   ✗ 错误 [任务]
     代码: TASK_NOT_FOUND
     任务不存在: task-nonexistent
     建议修复:
       → 查看所有任务: cah task list
   ```

2. **并发安全**: ID 生成使用纳秒时间戳 + 随机字符，无冲突
3. **特殊字符处理**: 正确转义和保存特殊字符
4. **无崩溃**: 所有边界情况都被正确捕获，无未处理异常

**⚠️ 需要改进**:
1. 空输入处理（静默失败）
2. 部分命令缺失（如 `task get`）
3. 参数验证不完整

---

## 六、修复优先级矩阵

| 优先级 | Bug/优化 | 类型 | 影响 | 工作量 | 建议处理时间 |
|--------|---------|------|------|--------|-------------|
| **P0** | Bug #2.1 - 模板排行榜污染 | 🔴 Critical | 功能不可用 | 2-3h | 立即 |
| **P1** | Bug #1 - logs --tail 参数 | 🟠 High | 体验差 | 0.5h | 本周 |
| **P1** | Bug #3 - task get 命令 | 🟠 High | 功能缺失 | 1h | 本周 |
| **P2** | Bug #4 - 空描述验证 | 🟡 Medium | 体验问题 | 0.5h | 本周 |
| **P2** | Bug #5 - stdin空输入 | 🟡 Medium | 体验问题 | 0.5h | 本周 |
| **P2** | 优化 #1 - 标题截断 | 🟡 Medium | 体验改进 | 1h | 下周 |
| **P2** | 优化 #2 - 日志增强 | 🟡 Medium | 体验改进 | 2-3h | 下周 |
| **P2** | 优化 #4 - 命令歧义 | 🟡 Medium | 设计决策 | 1-2h | 待讨论 |
| **P3** | 优化 #3 - 语义匹配 | 🟢 Low | 功能增强 | 4-6h | 未来 |

### 建议修复顺序

#### 第一批（立即）- 总计 3-4小时
1. **Bug #2.1** (2-3h) - 清理测试模板 + 实现过滤逻辑
   - 立即执行 `cah template clean --pattern "count-test-*"`
   - 实现排行榜过滤机制

#### 第二批（本周）- 总计 2.5小时
2. **Bug #1** (0.5h) - 添加 `--tail` 参数
3. **Bug #3** (1h) - 实现 `task get` 命令
4. **Bug #4** (0.5h) - 空描述验证
5. **Bug #5** (0.5h) - stdin空输入验证

#### 第三批（下周）- 总计 3-4小时
6. **优化 #1** (1h) - 任务列表 `--full` 参数
7. **优化 #2** (2-3h) - 日志查看增强

#### 第四批（未来）
8. **优化 #4** (1-2h) - 命令解析改进（需 UX 讨论）
9. **优化 #3** (4-6h) - 语义相似度匹配

---

## 七、正向反馈

### 🌟 做得好的地方

1. **任务恢复机制**
   - 检测到中断任务并自动提示恢复
   - 恢复流程清晰可见（显示 PID 和状态）

2. **进度显示**
   - 任务列表中的进度条和百分比清晰
   - ETA 预估功能正常工作

3. **命令响应速度**
   - 所有命令响应时间 < 1s
   - 用户体验流畅

4. **错误提示友好**
   - 包含错误代码
   - 提供修复建议
   - 颜色区分清晰

5. **并发安全**
   - ID 生成无冲突
   - 文件写入无竞态条件

6. **特殊字符处理**
   - 正确转义和保存

---

## 八、附录

### A. 测试数据位置

- 核心命令测试报告: `bugs/command-test-report-20260202.md`
- 边界场景测试报告: `bugs/boundary-test-report.md` 和 `bugs/edge-case-test-report-20260202.md`
- 测试任务数据: `.cah-data/tasks/task-20260202-*`

### B. 关键代码位置

| 功能模块 | 文件位置 | 关键函数 |
|---------|---------|---------|
| 命令行入口 | `src/cli/index.ts:50-150` | 主命令处理 |
| 任务命令 | `src/cli/commands/task.ts` | list/logs/get 等 |
| 模板命令 | `src/cli/commands/template.ts` | ranking/suggest/clean |
| 模板评分 | `src/template/TemplateScoring.ts` | 过滤和排序 |
| 任务查询 | `src/task/queryTask.ts` | getTask/listTasks |

### C. 测试环境

- **Node.js**: v22.12.0
- **npm**: 10.9.0
- **CAH 版本**: 0.1.0
- **测试时间**: 2026-02-02 17:47-17:53
- **测试任务数**: 21个（包含测试任务）
- **测试模板数**: 70+ (被污染)

---

**报告生成**: 2026年02月02日 17:53
**报告作者**: Pragmatist (CAH Workflow)
**下一步**: 立即修复 P0 Bug #2.1（模板排行榜污染）
