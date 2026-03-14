import { createOpencodeBackend } from './src/backend/opencodeBackend.js'
import { createIflowBackend } from './src/backend/iflowBackend.js'
import { createCodebuddyBackend } from './src/backend/codebuddyBackend.js'

const TEST_PROMPT = '用一句话介绍你自己'

async function testBackend(name: string, backend: any, model?: string) {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`测试 ${name} ${model ? `(model: ${model})` : ''}`)
  console.log('='.repeat(50))

  const startTime = Date.now()
  const result = await backend.invoke({
    prompt: TEST_PROMPT,
    cwd: process.cwd(),
    stream: false,
    timeoutMs: 120000,
    model,
  })

  const durationMs = Date.now() - startTime

  if (result.ok) {
    console.log(`✅ 成功!`)
    console.log(`   总耗时: ${(durationMs / 1000).toFixed(2)}s`)
    console.log(`   后端耗时: ${(result.value.durationMs / 1000).toFixed(2)}s`)
    console.log(`   响应长度: ${result.value.response.length} 字符`)
    console.log(`   Session ID: ${result.value.sessionId || '无'}`)
    console.log(`   响应内容: ${result.value.response.slice(0, 100)}...`)
    return { name, success: true, durationMs, backendDurationMs: result.value.durationMs }
  } else {
    console.log(`❌ 失败!`)
    console.log(`   错误: ${result.error.message}`)
    return { name, success: false, durationMs, error: result.error.message }
  }
}

async function main() {
  console.log('🚀 开始测试三个 Backend 的响应速度')
  console.log(`📝 测试 Prompt: "${TEST_PROMPT}"`)
  console.log(`📁 工作目录: ${process.cwd()}`)

  const results = []

  // Test opencode with minimax-m2.5-free
  const opencodeBackend = createOpencodeBackend()
  results.push(await testBackend('opencode', opencodeBackend, 'opencode/minimax-m2.5-free'))

  // Test iflow with Kimi-K2.5
  const iflowBackend = createIflowBackend()
  results.push(await testBackend('iflow', iflowBackend, 'Kimi-K2.5'))

  // Test codebuddy with glm-5.0
  const codebuddyBackend = createCodebuddyBackend()
  results.push(await testBackend('codebuddy', codebuddyBackend, 'glm-5.0'))

  // Summary
  console.log(`\n${'='.repeat(50)}`)
  console.log('📊 测试结果汇总')
  console.log('='.repeat(50))

  const successful = results.filter(r => r.success).sort((a, b) => a.durationMs - b.durationMs)

  for (const r of successful) {
    console.log(`${r.name}: ${(r.durationMs / 1000).toFixed(2)}s`)
  }

  console.log(`\n🏆 最快: ${successful[0]?.name || 'N/A'}`)
}

main().catch(console.error)
