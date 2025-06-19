#!/bin/bash

# ===== EasySSH 极致优化构建脚本 =====
# 功能：最快速度的Docker镜像构建
# 特点：预构建、缓存复用、并行构建

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 配置
IMAGE_NAME="shanheee/easyssh"
BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_REF=$(git symbolic-ref -q --short HEAD 2>/dev/null || echo "unknown")

# 检查 BuildKit
check_buildkit() {
    if ! docker buildx version >/dev/null 2>&1; then
        print_error "Docker Buildx 未安装，请先安装 BuildKit"
        exit 1
    fi
    print_success "BuildKit 检查通过"
}

# 预构建前端（本地构建，避免在Docker中构建）
prebuild_frontend() {
    print_info "开始本地预构建前端..."
    
    if [ ! -d "node_modules" ]; then
        print_info "安装前端依赖..."
        npm ci --legacy-peer-deps --no-audit --no-fund
    fi
    
    print_info "构建前端..."
    NODE_ENV=production npm run build
    
    print_success "前端预构建完成"
}

# 极致优化构建
optimized_build() {
    local version=${1:-"latest"}

    print_info "开始极致优化构建..."

    # 使用 BuildKit 进行优化构建（兼容版本）
    DOCKER_BUILDKIT=1 docker build \
        --build-arg BUILD_DATE="${BUILD_DATE}" \
        --build-arg GIT_SHA="${GIT_SHA}" \
        --build-arg GIT_REF="${GIT_REF}" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --tag "${IMAGE_NAME}:${version}" \
        --tag "${IMAGE_NAME}:latest" \
        -f Dockerfile \
        .
    
    if [ $? -eq 0 ]; then
        print_success "极致优化构建完成"
        
        # 显示镜像信息
        print_info "镜像信息:"
        docker images "${IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"
    else
        print_error "构建失败"
        exit 1
    fi
}

# 清理构建产物
cleanup() {
    print_info "清理构建产物..."
    rm -rf dist/
    print_success "清理完成"
}

# 主函数
main() {
    local action=${1:-"build"}
    local version=${2:-"latest"}
    
    print_info "=== EasySSH 极致优化构建工具 ==="
    print_info "构建信息:"
    echo "  - 仓库: ${IMAGE_NAME}"
    echo "  - 版本: ${version}"
    echo "  - 构建时间: ${BUILD_DATE}"
    echo "  - Git SHA: ${GIT_SHA}"
    echo "  - Git 分支: ${GIT_REF}"
    echo ""
    
    check_buildkit
    
    case $action in
        "build")
            prebuild_frontend
            optimized_build "$version"
            ;;
        "clean")
            cleanup
            ;;
        "full")
            cleanup
            prebuild_frontend
            optimized_build "$version"
            cleanup
            ;;
        *)
            print_error "未知操作: $action"
            echo "用法: $0 [build|clean|full] [version]"
            echo "示例:"
            echo "  $0 build v1.0.1     # 极致优化构建"
            echo "  $0 full v1.0.1      # 完整构建（包含清理）"
            echo "  $0 clean            # 清理构建产物"
            exit 1
            ;;
    esac
    
    print_success "操作完成！"
}

# 执行主函数
main "$@"
