#!/bin/bash
# 并发测试环境准备脚本

set -e

echo "🔧 准备并发测试环境..."

# 1. 检查依赖
echo ""
echo "📦 检查依赖..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: Node.js 未安装"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ 错误: Node.js 版本需要 >= 20.0.0，当前版本: $(node -v)"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 2. 安装依赖
echo ""
echo "📦 安装依赖..."
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "✅ node_modules 已存在"
fi

# 3. 构建项目
echo ""
echo "🔨 构建项目..."
npm run build

if [ ! -f "dist/cli/index.js" ]; then
    echo "❌ 错误: 构建失败，未找到 dist/cli/index.js"
    exit 1
fi

echo "✅ 构建完成"

# 4. 准备测试数据目录
echo ""
echo "📁 准备测试数据目录..."

TEST_DATA_DIR="${CAH_DATA_DIR:-/tmp/cah-test-data}"

if [ -d "$TEST_DATA_DIR" ]; then
    echo "⚠️  测试数据目录已存在: $TEST_DATA_DIR"
    read -p "是否清理? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$TEST_DATA_DIR"
        echo "✅ 已清理旧数据"
    fi
fi

mkdir -p "$TEST_DATA_DIR"
echo "✅ 测试数据目录: $TEST_DATA_DIR"

# 5. 验证测试文件
echo ""
echo "📝 验证测试文件..."

if [ ! -f "tests/concurrency.test.ts" ]; then
    echo "❌ 错误: 未找到 tests/concurrency.test.ts"
    exit 1
fi

if [ ! -f "tests/helpers/concurrency.ts" ]; then
    echo "❌ 错误: 未找到 tests/helpers/concurrency.ts"
    exit 1
fi

echo "✅ 测试文件就绪"

# 6. 运行类型检查
echo ""
echo "🔍 运行类型检查..."
npm run typecheck

# 7. 显示环境信息
echo ""
echo "📊 环境信息:"
echo "  Node.js:       $(node -v)"
echo "  npm:           $(npm -v)"
echo "  工作目录:      $(pwd)"
echo "  测试数据目录:  $TEST_DATA_DIR"
echo "  CLI 路径:      dist/cli/index.js"
echo ""

# 8. 提示下一步
echo "✅ 并发测试环境准备完成！"
echo ""
echo "📚 运行测试:"
echo "  npm test concurrency               # 运行所有并发测试"
echo "  npm test -- -t \"队列操作\"          # 运行特定测试"
echo "  npm run test:watch -- concurrency  # 开发模式"
echo ""
echo "🔧 调试:"
echo "  CAH_LOG_LEVEL=debug npm test concurrency  # 开启详细日志"
echo ""
