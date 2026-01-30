# BUG-007: execa 调用 Claude CLI 挂起

## 问题描述
使用 `execa` 库调用 `claude --print` 命令时，进程会挂起直到超时，而直接在终端运行同样的命令可以正常工作。

## 复现步骤
```javascript
import { execa } from 'execa';

// 这会超时
const result = await execa('claude', ['--print', '--dangerously-skip-permissions', '请回复 OK'], {
  timeout: 60000
});
```

## 直接终端测试（正常工作）
```bash
claude --print --dangerously-skip-permissions "请回复 OK"
# 输出: OK
```

## 问题代码位置
[invokeClaudeCode.ts:33](src/claude/invokeClaudeCode.ts#L33)

```typescript
const result = await execa('claude', args, {
  cwd: cwd || process.cwd(),
  timeout: 30 * 60 * 1000,
  // ...
})
```

## 根本原因分析
可能的原因：
1. **TTY 问题**: Claude CLI 可能需要 TTY 环境来正确工作，而 `execa` 默认不提供 TTY
2. **stdin 问题**: Claude CLI 可能在等待 stdin 输入
3. **环境变量**: 可能缺少某些必要的环境变量

## 建议修复

### 方案 1: 使用 shell 模式
```typescript
const result = await execa('claude', args, {
  shell: true,
  // ...
})
```

### 方案 2: 使用 stdio 配置
```typescript
const result = await execa('claude', args, {
  stdin: 'ignore',
  // 或者
  stdio: ['ignore', 'pipe', 'pipe']
})
```

### 方案 3: 使用 spawn 并处理 stdin
```typescript
import { spawn } from 'child_process';

const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(); // 关闭 stdin
```

### 方案 4: 使用 echo 管道
```typescript
const result = await execa('sh', ['-c', `echo "" | claude --print "${prompt}"`])
```

## 优先级
**Critical** - 这会导致所有 Agent 任务无法执行

## 状态
待修复
