#!/bin/bash
# Generate all HTTP types from contracts/http/openapi.yaml.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:---all}"
case "$mode" in
    --all|--go|--ts) ;;
    *) echo "Usage: scripts/gen-types.sh [--all|--go|--ts]" >&2; exit 2 ;;
esac
node scripts/check-openapi-routes.mjs
if [ "$mode" != --ts ]; then
    # Uses the oapi-codegen version pinned by server/go.mod.
    (cd server; go tool oapi-codegen --config ../contracts/http/go-models.yaml -o ../shared/protocol/generated.go ../contracts/http/openapi.yaml)
fi
if [ "$mode" != --go ]; then
    if [ ! -x packages/app/node_modules/.bin/openapi-typescript ]; then
        echo "缺少固定版本的 openapi-typescript，请先在仓库根目录执行 pnpm install" >&2
        exit 1
    fi
    packages/app/node_modules/.bin/openapi-typescript contracts/http/openapi.yaml -o packages/app/src/generated/openapi.ts
fi
