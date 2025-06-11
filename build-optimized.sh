#!/bin/bash

# 优化的Docker构建脚本
set -e

echo "🚀 开始优化的Docker构建..."

# 记录开始时间
START_TIME=$(date +%s)

# 清理旧的构建缓存（可选）
if [ "$1" = "--clean" ]; then
    echo "🧹 清理Docker构建缓存..."
    docker builder prune -f
    docker system prune -f
fi

# 启用Docker BuildKit
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

echo "📦 构建Docker镜像..."

# 构建镜像
docker build \
    --tag easyssh:optimized \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --cache-from easyssh:optimized \
    .

# 记录结束时间
END_TIME=$(date +%s)
BUILD_TIME=$((END_TIME - START_TIME))

echo "✅ 构建完成！"
echo "⏱️  构建时间: ${BUILD_TIME}秒"

# 显示镜像信息
echo "📊 镜像信息:"
docker images easyssh:optimized --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# 分析镜像层
echo "🔍 镜像层分析:"
docker history easyssh:optimized --format "table {{.CreatedBy}}\t{{.Size}}"

# 可选：运行容器测试
if [ "$2" = "--test" ]; then
    echo "🧪 启动测试容器..."
    docker run -d \
        --name easyssh-test \
        -p 3000:3000 \
        -p 8000:8000 \
        easyssh:optimized
    
    echo "⏳ 等待服务启动..."
    sleep 10
    
    # 健康检查
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ 服务启动成功！"
    else
        echo "❌ 服务启动失败"
        docker logs easyssh-test
    fi
    
    # 清理测试容器
    docker stop easyssh-test
    docker rm easyssh-test
fi

echo "🎉 构建脚本执行完成！"
echo ""
echo "使用方法:"
echo "  docker run -d -p 3000:3000 -p 8000:8000 easyssh:optimized"
echo "  或者使用: docker-compose up -d"
