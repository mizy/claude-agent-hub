/**
 * 内置模板定义
 */

import type { TaskTemplate } from './types.js'

type BuiltinTemplate = Omit<TaskTemplate, 'id' | 'createdAt' | 'usageCount'>

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // 开发任务
  {
    name: 'implement-feature',
    description: '实现新功能',
    category: 'development',
    prompt: '实现以下功能: {{feature_description}}\n\n要求:\n- 遵循项目现有的代码风格和架构\n- 添加必要的类型定义\n- 处理边界情况和错误',
    variables: [
      { name: 'feature_description', description: '功能描述', required: true },
    ],
    tags: ['feature', 'development'],
  },
  {
    name: 'fix-bug',
    description: '修复 Bug',
    category: 'development',
    prompt: '修复以下问题: {{bug_description}}\n\n{{reproduction_steps}}\n\n期望行为: {{expected_behavior}}',
    variables: [
      { name: 'bug_description', description: 'Bug 描述', required: true },
      { name: 'reproduction_steps', description: '复现步骤', defaultValue: '' },
      { name: 'expected_behavior', description: '期望行为', defaultValue: '' },
    ],
    tags: ['bugfix', 'development'],
  },
  {
    name: 'add-api-endpoint',
    description: '添加 API 端点',
    category: 'development',
    prompt: '添加新的 API 端点:\n\n端点: {{method}} {{path}}\n描述: {{description}}\n\n请求参数:\n{{request_params}}\n\n响应格式:\n{{response_format}}',
    variables: [
      { name: 'method', description: 'HTTP 方法', defaultValue: 'GET' },
      { name: 'path', description: 'API 路径', required: true },
      { name: 'description', description: '端点描述', required: true },
      { name: 'request_params', description: '请求参数', defaultValue: '无' },
      { name: 'response_format', description: '响应格式', defaultValue: 'JSON' },
    ],
    tags: ['api', 'development'],
  },

  // 测试任务
  {
    name: 'write-unit-tests',
    description: '编写单元测试',
    category: 'testing',
    prompt: '为以下模块编写单元测试: {{module_path}}\n\n测试要求:\n- 覆盖主要功能路径\n- 包含边界情况测试\n- 包含错误处理测试\n- 使用项目现有的测试框架',
    variables: [
      { name: 'module_path', description: '模块路径', required: true },
    ],
    tags: ['testing', 'unit-test'],
  },
  {
    name: 'add-integration-tests',
    description: '添加集成测试',
    category: 'testing',
    prompt: '为以下功能添加集成测试: {{feature_name}}\n\n测试场景:\n{{test_scenarios}}\n\n确保测试覆盖完整的用户流程。',
    variables: [
      { name: 'feature_name', description: '功能名称', required: true },
      { name: 'test_scenarios', description: '测试场景', defaultValue: '' },
    ],
    tags: ['testing', 'integration'],
  },

  // 重构任务
  {
    name: 'refactor-module',
    description: '重构模块',
    category: 'refactoring',
    prompt: '重构以下模块: {{module_path}}\n\n重构目标:\n{{refactor_goals}}\n\n约束:\n- 保持现有 API 兼容\n- 确保测试通过\n- 不引入新依赖',
    variables: [
      { name: 'module_path', description: '模块路径', required: true },
      { name: 'refactor_goals', description: '重构目标', defaultValue: '提升代码可读性和可维护性' },
    ],
    tags: ['refactoring'],
  },
  {
    name: 'extract-component',
    description: '抽取组件/函数',
    category: 'refactoring',
    prompt: '从 {{source_file}} 中抽取 {{component_name}}\n\n抽取原因: {{reason}}\n\n目标位置: {{target_path}}',
    variables: [
      { name: 'source_file', description: '源文件', required: true },
      { name: 'component_name', description: '组件/函数名', required: true },
      { name: 'reason', description: '抽取原因', defaultValue: '提高复用性' },
      { name: 'target_path', description: '目标路径', defaultValue: '自动选择' },
    ],
    tags: ['refactoring', 'component'],
  },

  // 文档任务
  {
    name: 'generate-docs',
    description: '生成文档',
    category: 'documentation',
    prompt: '为以下模块生成文档: {{module_path}}\n\n文档要求:\n- 包含 API 说明\n- 包含使用示例\n- 包含参数说明\n- 使用 {{doc_format}} 格式',
    variables: [
      { name: 'module_path', description: '模块路径', required: true },
      { name: 'doc_format', description: '文档格式', defaultValue: 'JSDoc' },
    ],
    tags: ['documentation'],
  },
  {
    name: 'update-readme',
    description: '更新 README',
    category: 'documentation',
    prompt: '更新 README.md，添加以下内容:\n\n{{content_to_add}}\n\n保持现有文档结构，只添加/更新必要的部分。',
    variables: [
      { name: 'content_to_add', description: '要添加的内容', required: true },
    ],
    tags: ['documentation', 'readme'],
  },

  // DevOps 任务
  {
    name: 'setup-ci',
    description: '配置 CI/CD',
    category: 'devops',
    prompt: '配置 CI/CD 流水线:\n\n平台: {{ci_platform}}\n\n需要的步骤:\n- {{pipeline_steps}}\n\n触发条件: {{triggers}}',
    variables: [
      { name: 'ci_platform', description: 'CI 平台', defaultValue: 'GitHub Actions' },
      { name: 'pipeline_steps', description: '流水线步骤', defaultValue: 'lint, test, build' },
      { name: 'triggers', description: '触发条件', defaultValue: 'push to main, pull request' },
    ],
    tags: ['devops', 'ci'],
  },
  {
    name: 'add-docker',
    description: '添加 Docker 支持',
    category: 'devops',
    prompt: '为项目添加 Docker 支持:\n\n基础镜像: {{base_image}}\n暴露端口: {{ports}}\n\n要求:\n- 多阶段构建\n- 生产环境优化\n- 添加 docker-compose.yml (如需要)',
    variables: [
      { name: 'base_image', description: '基础镜像', defaultValue: 'node:20-alpine' },
      { name: 'ports', description: '暴露端口', defaultValue: '3000' },
    ],
    tags: ['devops', 'docker'],
  },

  // 分析任务
  {
    name: 'analyze-performance',
    description: '性能分析',
    category: 'analysis',
    prompt: '分析以下模块/功能的性能: {{target}}\n\n关注点:\n- 时间复杂度\n- 内存使用\n- 潜在瓶颈\n\n提供优化建议。',
    variables: [
      { name: 'target', description: '分析目标', required: true },
    ],
    tags: ['analysis', 'performance'],
  },
  {
    name: 'code-review',
    description: '代码审查',
    category: 'analysis',
    prompt: '审查以下文件/模块的代码: {{file_path}}\n\n审查重点:\n- 代码质量\n- 潜在 Bug\n- 安全问题\n- 可维护性\n\n提供改进建议。',
    variables: [
      { name: 'file_path', description: '文件路径', required: true },
    ],
    tags: ['analysis', 'review'],
  },
]
