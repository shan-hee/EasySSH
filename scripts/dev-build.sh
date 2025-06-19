#!/bin/bash

# ===== EasySSH 开发环境快速构建脚本 =====
# 功能：本地开发环境的快速Docker构建
# 特点：利用缓存、并行构建、快速迭代

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 配置
IMAGE_NAME="easyssh:dev"
CACHE_DIR="/tmp/.easyssh-buildx-cache"

# 创建缓存目录
mkdir -p "$CACHE_DIR"

print_info "开始快速构建开发镜像..."

# 检查是否有现有镜像用作缓存
if docker images "$IMAGE_NAME" --format "{{.Repository}}:{{.Tag}}" | grep -q "$IMAGE_NAME"; then
    print_info "发现现有镜像，将用作构建缓存"
    CACHE_FROM="--cache-from $IMAGE_NAME"
else
    CACHE_FROM=""
fi

# 启用BuildKit并构建
print_info "使用BuildKit进行优化构建..."

DOCKER_BUILDKIT=1 docker build \
    --target runtime \
    --tag "$IMAGE_NAME" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'dev')" \
    --build-arg GIT_REF="$(git symbolic-ref -q --short HEAD 2>/dev/null || echo 'dev')" \
    $CACHE_FROM \
    .

if [ $? -eq 0 ]; then
    print_success "开发镜像构建完成: $IMAGE_NAME"
    
    # 显示镜像信息
    print_info "镜像信息:"
    docker images "$IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"
    
    # 提供运行建议
    echo ""
    print_info "运行建议:"
    echo "  docker run -d -p 8520:8520 --name easyssh-dev $IMAGE_NAME"
    echo "  docker logs -f easyssh-dev"
    echo ""
else
    print_warning "构建失败，请检查错误信息"
    exit 1
fi
