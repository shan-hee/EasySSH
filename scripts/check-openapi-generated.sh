#!/bin/bash
# Compare pinned generator output without changing checked-in Go or TS files.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:---all}"
case "$mode" in
    --all|--go|--ts) ;;
    *) echo "Usage: scripts/check-openapi-generated.sh [--all|--go|--ts]" >&2; exit 2 ;;
esac
contract_check_dir=$(mktemp -d)
trap 'rm -rf "$contract_check_dir"' EXIT
stale=0
compare_generated() {
    if ! cmp -s "$1" "$2"; then
        echo "生成物与 OpenAPI 不一致: $2" >&2
        stale=1
    fi
}
if [ "$mode" != --ts ]; then
    # Uses the same pinned tool and configuration as gen-types.sh.
    (cd server; go tool oapi-codegen --config ../contracts/http/go-models.yaml -o "$contract_check_dir/protocol.go" ../contracts/http/openapi.yaml)
    compare_generated "$contract_check_dir/protocol.go" shared/protocol/generated.go
fi
if [ "$mode" != --go ]; then
    if [ ! -x packages/app/node_modules/.bin/openapi-typescript ]; then
        echo "缺少固定版本的 openapi-typescript，请先在仓库根目录执行 pnpm install" >&2
        exit 1
    fi
    packages/app/node_modules/.bin/openapi-typescript contracts/http/openapi.yaml -o "$contract_check_dir/openapi.ts"
    compare_generated "$contract_check_dir/openapi.ts" packages/app/src/generated/openapi.ts
fi
if [ "$stale" != 0 ]; then
    echo "请使用 scripts/gen-types.sh $mode 更新对应生成物并提交。" >&2
    exit 1
fi
echo "OpenAPI 生成物一致。"
