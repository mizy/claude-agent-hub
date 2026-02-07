#!/bin/bash
# Build Node.js Single Executable Application (SEA)
#
# 步骤：
# 1. esbuild 打包所有代码为单个 CJS 文件
# 2. 生成 SEA blob
# 3. 注入到 node 二进制副本中
#
# 要求: Node.js >= 20

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/dist-sea"
ENTRY="$PROJECT_DIR/src/cli/entry.ts"
BUNDLE="$BUILD_DIR/cah.cjs"
BLOB="$BUILD_DIR/cah.blob"
SEA_CONFIG="$BUILD_DIR/sea-config.json"
OUTPUT="$BUILD_DIR/cah"

echo "=== Building CAH Single Executable ==="

# 清理
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 1. 构建并复制 dashboard 静态资源
echo "[1/4] Building dashboard and copying static assets..."
cd "$PROJECT_DIR/src/server/dashboard" && pnpm run build
mkdir -p "$BUILD_DIR/server/public"
cp -r "$PROJECT_DIR/dist/server/public/"* "$BUILD_DIR/server/public/" 2>/dev/null || true

# 2. esbuild 打包为单个 CJS 文件
echo "[2/4] Bundling with esbuild..."
npx esbuild "$ENTRY" \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile="$BUNDLE" \
  --banner:js="var _pe=process.emit;process.emit=function(e,w){if(e==='warning'&&w&&typeof w.message==='string'&&w.message.includes('single-executable'))return false;return _pe.apply(this,arguments)};const __importMetaUrl = require('url').pathToFileURL(__filename).href;" \
  --define:import.meta.url=__importMetaUrl \
  --minify-syntax

BUNDLE_SIZE=$(du -sh "$BUNDLE" | cut -f1)
echo "   Bundle: $BUNDLE_SIZE"

# 3. 生成 SEA 配置和 blob
echo "[3/4] Generating SEA blob..."
cat > "$SEA_CONFIG" <<EOF
{
  "main": "$BUNDLE",
  "output": "$BLOB",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "assets": {
    "sea-config": "$SEA_CONFIG"
  }
}
EOF

node --experimental-sea-config "$SEA_CONFIG"

# 4. 注入到 node 副本
echo "[4/4] Injecting into node binary..."
cp "$(command -v node)" "$OUTPUT"

# macOS 需要先移除签名再注入
if [[ "$(uname)" == "Darwin" ]]; then
  codesign --remove-signature "$OUTPUT" 2>/dev/null || true
fi

npx postject "$OUTPUT" NODE_SEA_BLOB "$BLOB" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# macOS 重新签名
if [[ "$(uname)" == "Darwin" ]]; then
  codesign --sign - "$OUTPUT" 2>/dev/null || true
fi

chmod +x "$OUTPUT"
OUTPUT_SIZE=$(du -sh "$OUTPUT" | cut -f1)

echo ""
echo "=== Build complete ==="
echo "Binary: $OUTPUT ($OUTPUT_SIZE)"
echo ""
echo "Usage:"
echo "  $OUTPUT \"任务描述\"      # 创建并执行任务"
echo "  $OUTPUT task list       # 查看任务列表"
