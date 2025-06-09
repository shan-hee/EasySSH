#!/bin/bash

# EasySSH 快速启动脚本

set -e

echo "🚀 EasySSH 快速启动脚本"
echo "========================"

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    echo "   安装指南: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查Docker是否运行
if ! docker info &> /dev/null; then
    echo "❌ Docker 未运行，请启动 Docker 服务"
    exit 1
fi

echo "✅ Docker 环境检查通过"

# 选择启动方式
echo ""
echo "请选择启动方式："
echo "1) 使用 Docker Hub 镜像 (推荐)"
echo "2) 本地构建镜像"
echo "3) 使用 Docker Compose"

read -p "请输入选择 (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🐳 使用 Docker Hub 镜像启动..."
        
        # 停止并删除旧容器
        docker stop easyssh 2>/dev/null || true
        docker rm easyssh 2>/dev/null || true
        
        # 拉取并运行最新镜像
        echo "📥 拉取最新镜像..."
        docker pull shanheee/easyssh:latest
        
        echo "🚀 启动容器..."
        docker run -d \
          --name easyssh \
          --restart unless-stopped \
          -p 80:80 \
          -p 8000:8000 \
          shanheee/easyssh:latest
        
        echo "✅ 容器启动成功！"
        ;;
        
    2)
        echo ""
        echo "🔨 本地构建镜像..."
        
        # 检查是否在项目目录
        if [ ! -f "Dockerfile" ]; then
            echo "❌ 未找到 Dockerfile，请确保在项目根目录运行此脚本"
            exit 1
        fi
        
        # 构建镜像
        echo "🔨 构建 Docker 镜像..."
        docker build -t easyssh:local .
        
        # 停止并删除旧容器
        docker stop easyssh-local 2>/dev/null || true
        docker rm easyssh-local 2>/dev/null || true
        
        # 运行容器
        echo "🚀 启动容器..."
        docker run -d \
          --name easyssh-local \
          --restart unless-stopped \
          -p 80:80 \
          -p 8000:8000 \
          easyssh:local
        
        echo "✅ 本地构建容器启动成功！"
        ;;
        
    3)
        echo ""
        echo "🐙 使用 Docker Compose 启动..."
        
        # 检查docker-compose文件
        if [ ! -f "docker-compose.yml" ]; then
            echo "❌ 未找到 docker-compose.yml，请确保在项目根目录运行此脚本"
            exit 1
        fi
        
        # 检查docker-compose是否安装
        if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
            echo "❌ Docker Compose 未安装"
            exit 1
        fi
        
        # 启动服务
        echo "🚀 启动 Docker Compose 服务..."
        if command -v docker-compose &> /dev/null; then
            docker-compose up -d
        else
            docker compose up -d
        fi
        
        echo "✅ Docker Compose 服务启动成功！"
        ;;
        
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

# 等待服务启动
echo ""
echo "⏳ 等待服务启动..."
sleep 10

# 健康检查
echo "🔍 检查服务状态..."
if curl -f http://localhost/health &> /dev/null; then
    echo "✅ 服务健康检查通过"
else
    echo "⚠️  健康检查失败，请检查日志"
fi

# 显示访问信息
echo ""
echo "🎉 EasySSH 启动完成！"
echo "========================"
echo "📱 前端访问地址: http://localhost"
echo "🔧 后端API地址: http://localhost:8000"
echo ""
echo "📊 查看容器状态:"
docker ps | grep easyssh

echo ""
echo "📝 查看日志:"
if [ "$choice" = "1" ]; then
    echo "   docker logs easyssh"
elif [ "$choice" = "2" ]; then
    echo "   docker logs easyssh-local"
else
    echo "   docker-compose logs -f"
fi

echo ""
echo "🛑 停止服务:"
if [ "$choice" = "1" ]; then
    echo "   docker stop easyssh"
elif [ "$choice" = "2" ]; then
    echo "   docker stop easyssh-local"
else
    echo "   docker-compose down"
fi

echo ""
echo "📚 更多信息请查看 DOCKER.md 文档"
