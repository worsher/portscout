#!/bin/bash
# 录制 README 演示 GIF：起一个假项目的 dev server，用 vhs 回放 demo.tape
# 依赖：brew install vhs
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=$(mktemp -d /tmp/my-app.XXXX)
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$DEMO_DIR"' EXIT

DEMO_BIN="$DEMO_DIR/bin"
mkdir -p "$DEMO_BIN"
cp scripts/portmarshal-demo.sh "$DEMO_BIN/portmarshal"
chmod +x "$DEMO_BIN/portmarshal"

# 模拟另一个 agent 在 my-app 项目里启动的 dev server（cwd 归属演示）
(cd "$DEMO_DIR" && exec node -e 'require("http").createServer((q,r)=>r.end("ok")).listen(18923,"127.0.0.1")') &
SERVER_PID=$!
sleep 1

pnpm build > /dev/null
PATH="$DEMO_BIN:$PATH" \
  PORTMARSHAL_CLI="$PWD/dist/cli.js" \
  PORTMARSHAL_STATE_DIR="$DEMO_DIR/state" \
  DEMO_PROJECT="$DEMO_DIR" \
  vhs scripts/demo.tape
echo "生成完成: docs/demo.gif"
