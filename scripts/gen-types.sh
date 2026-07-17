#!/bin/bash

# 从唯一 OpenAPI 契约生成 Go 与 TypeScript 类型

set -e

echo "🔄 生成 API 契约代码..."

if [ ! -f shared/openapi.yaml ]; then
    echo "⚠️  未找到 shared/openapi.yaml 文件"
    echo "请先创建 OpenAPI 规范文件"
    exit 1
fi

node scripts/check-openapi-routes.mjs

echo "📝 生成 Go 类型与嵌入规范..."
(
    cd server
    go tool oapi-codegen --config oapi-codegen.yaml ../shared/openapi.yaml
)

echo "📝 生成 TypeScript 类型..."
if [ ! -x web/node_modules/.bin/openapi-typescript ]; then
    echo "❌ 缺少 web/node_modules 中固定版本的 openapi-typescript，请先执行依赖安装"
    exit 1
fi
web/node_modules/.bin/openapi-typescript shared/openapi.yaml -o web/src/types/openapi.ts

echo "✅ API 契约代码生成完成！"
