#!/bin/bash

# 测试Docker构建脚本
# 用于验证修复后的构建是否正常

echo "开始测试Docker构建..."

# 检查必要文件是否存在
echo "检查必要文件..."
if [ ! -f "package.json" ]; then
    echo "❌ package.json 不存在"
    exit 1
fi

if [ ! -f "package-lock.json" ]; then
    echo "❌ package-lock.json 不存在"
    exit 1
fi

if [ ! -f "server/package.json" ]; then
    echo "❌ server/package.json 不存在"
    exit 1
fi

if [ ! -f "server/package-lock.json" ]; then
    echo "❌ server/package-lock.json 不存在"
    exit 1
fi

echo "✅ 所有必要文件都存在"

# 构建Docker镜像（仅测试构建，不推送）
echo "开始构建Docker镜像..."
docker build -t easyssh-test:latest .

if [ $? -eq 0 ]; then
    echo "✅ Docker构建成功！"
    
    # 清理测试镜像
    echo "清理测试镜像..."
    docker rmi easyssh-test:latest
    
    echo "🎉 测试完成，构建修复成功！"
else
    echo "❌ Docker构建失败"
    exit 1
fi
