#!/bin/bash
# 锁性能测试任务 12 - 执行脚本

set -e

REPORT_DIR="tests/reports/lock-performance/task-12"
TEST_FILE="tests/lock-performance-task12.test.ts"

echo "================================================"
echo "锁性能测试 - 任务 12"
echo "性能退化专项调查"
echo "================================================"
echo ""
echo "测试目标: 调查并发性能退化 17.5% (1.48ms vs 1.26ms)"
echo "测试场景: 11 个"
echo "预计耗时: ~25 分钟"
echo ""

# 环境检查
echo "📋 环境检查..."
echo "  Node 版本: $(node --version)"
echo "  工作目录: $(pwd)"
echo "  测试文件: $TEST_FILE"
echo "  报告目录: $REPORT_DIR"
echo ""

# 确保报告目录存在
mkdir -p "$REPORT_DIR"

# 提示用户
echo "⚠️  请注意:"
echo "  1. 测试期间请关闭不必要的后台应用"
echo "  2. 测试将持续约 25 分钟，请勿中断"
echo "  3. 测试结果将保存到 $REPORT_DIR/"
echo ""

read -p "是否继续? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "已取消测试"
  exit 0
fi

echo ""
echo "🚀 开始测试..."
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 运行测试
npm test -- "$TEST_FILE" --reporter=verbose

echo ""
echo "✅ 测试完成!"
echo "结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "📊 测试结果已保存到:"
echo "  - $REPORT_DIR/performance-data.json"
echo ""
echo "下一步: 运行数据分析生成报告"
echo "  npm run analyze-performance-data"
echo ""
