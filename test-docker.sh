#!/bin/bash

# Docker 构建和测试脚本

set -e

echo "🐳 开始 Docker 构建和测试..."

# 清理旧的容器和镜像
echo "🧹 清理旧的容器和镜像..."
docker stop easyssh-test 2>/dev/null || true
docker rm easyssh-test 2>/dev/null || true
docker rmi easyssh:test 2>/dev/null || true

# 构建镜像
echo "🔨 构建 Docker 镜像..."
docker build -t easyssh:test .

# 运行容器
echo "🚀 启动测试容器..."
docker run -d \
  --name easyssh-test \
  -p 8080:80 \
  -p 8001:8000 \
  easyssh:test

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 测试健康检查
echo "🔍 测试健康检查..."
if curl -f http://localhost:8080/health; then
    echo "✅ 健康检查通过"
else
    echo "❌ 健康检查失败"
    docker logs easyssh-test
    exit 1
fi

# 测试前端页面
echo "🔍 测试前端页面..."
if curl -f http://localhost:8080/ > /dev/null; then
    echo "✅ 前端页面访问正常"
else
    echo "❌ 前端页面访问失败"
    docker logs easyssh-test
    exit 1
fi

# 显示容器信息
echo "📊 容器信息:"
docker ps | grep easyssh-test
echo ""
echo "📝 容器日志:"
docker logs easyssh-test --tail 20

echo ""
echo "🎉 Docker 测试完成!"
echo "📱 前端访问地址: http://localhost:8080"
echo "🔧 后端API地址: http://localhost:8001"
echo ""
echo "停止测试容器: docker stop easyssh-test"
echo "删除测试容器: docker rm easyssh-test"
