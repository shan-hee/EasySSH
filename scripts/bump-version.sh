#!/bin/bash

# EasySSH 版本号管理脚本
# 用于统一更新前后端版本号

set -e

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/desktop/EasySSHDesktop"

# 跨平台 sed -i (GNU sed / BSD sed)
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

# 检查参数
if [ -z "$1" ]; then
  echo -e "${RED}❌ 错误: 请提供版本号${NC}"
  echo -e "${YELLOW}用法: $0 <version>${NC}"
  echo -e "${YELLOW}示例: $0 1.0.1${NC}"
  exit 1
fi

VERSION=$1

# 验证版本号格式 (x.y.z)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo -e "${RED}❌ 错误: 版本号格式不正确${NC}"
  echo -e "${YELLOW}格式应为: x.y.z (例如: 1.0.1)${NC}"
  exit 1
fi

# 检查 tag 是否已存在
if git -C "$PROJECT_ROOT" rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo -e "${RED}❌ 错误: tag v$VERSION 已存在${NC}"
  exit 1
fi

echo -e "${BLUE}🚀 更新版本号到: ${VERSION}${NC}\n"

# 1. 更新 VERSION 文件
echo -e "${YELLOW}📝 更新 VERSION 文件...${NC}"
echo "$VERSION" > "$PROJECT_ROOT/VERSION"
echo -e "${GREEN}✅ VERSION 文件已更新${NC}\n"

# 2. 更新 web/package.json (可选)
if [ -f "$PROJECT_ROOT/web/package.json" ]; then
  echo -e "${YELLOW}📝 更新 web/package.json...${NC}"
  cd "$PROJECT_ROOT/web"

  # 使用 npm version 命令更新版本号（不创建 git tag）
  if command -v npm >/dev/null 2>&1; then
    npm version "$VERSION" --no-git-tag-version --allow-same-version
    echo -e "${GREEN}✅ web/package.json 已更新${NC}\n"
  else
    echo -e "${YELLOW}⚠️  npm 未安装，跳过 package.json 更新${NC}\n"
  fi

  cd "$PROJECT_ROOT"
fi

# 3. 更新桌面端版本号 (build 资产 + frontend/package.json)
if [ -f "$DESKTOP_DIR/build/config.yml" ]; then
  echo -e "${YELLOW}📝 更新桌面端版本号...${NC}"

  OLD_DESKTOP_VERSION=$(sed -n 's/^  version: "\([^"]*\)".*/\1/p' "$DESKTOP_DIR/build/config.yml" | head -1)

  if [ -z "$OLD_DESKTOP_VERSION" ]; then
    echo -e "${RED}❌ 错误: 无法从 build/config.yml 解析当前桌面端版本号${NC}"
    exit 1
  fi

  if [ "$OLD_DESKTOP_VERSION" = "$VERSION" ]; then
    echo -e "${GREEN}✅ 桌面端版本号已是 $VERSION，无需更新${NC}\n"
  else
    # build/ 下的资产 (manifest/plist/nsis/msix/nfpm 等) 由 wails3 生成并写死版本号，
    # 直接在包含旧版本号的文件里整体替换
    OLD_ESCAPED=$(printf '%s' "$OLD_DESKTOP_VERSION" | sed 's/\./\\./g')
    grep -rl -F "$OLD_DESKTOP_VERSION" "$DESKTOP_DIR/build" | while IFS= read -r f; do
      sed_inplace "s/$OLD_ESCAPED/$VERSION/g" "$f"
    done

    # 桌面前端 package.json + package-lock.json
    if [ -f "$DESKTOP_DIR/frontend/package.json" ]; then
      if command -v npm >/dev/null 2>&1; then
        (cd "$DESKTOP_DIR/frontend" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
      else
        echo -e "${YELLOW}⚠️  npm 未安装，跳过桌面前端 package.json 更新${NC}"
      fi
    fi

    echo -e "${GREEN}✅ 桌面端版本号 $OLD_DESKTOP_VERSION -> $VERSION${NC}\n"
  fi
fi

# 4. 更新 README 版本徽章
if grep -qE 'badge/version-[0-9]+\.[0-9]+\.[0-9]+-blue' "$PROJECT_ROOT/README.md" 2>/dev/null; then
  echo -e "${YELLOW}📝 更新 README 版本徽章...${NC}"
  sed_inplace -E "s|badge/version-[0-9]+\.[0-9]+\.[0-9]+-blue|badge/version-$VERSION-blue|" "$PROJECT_ROOT/README.md"
  echo -e "${GREEN}✅ README 版本徽章已更新${NC}\n"
fi

# 5. 显示变更
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📋 变更摘要:${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
git diff --stat VERSION web/package.json README.md desktop/EasySSHDesktop 2>/dev/null || true
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# 6. 询问是否提交并发版
echo -e "${YELLOW}是否提交变更并打 tag v$VERSION? (y/n)${NC}"
read -r CONFIRM

if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
  echo -e "\n${YELLOW}📦 提交变更...${NC}"

  # 添加文件
  git add VERSION README.md
  if [ -f "$PROJECT_ROOT/web/package.json" ]; then
    git add web/package.json
  fi
  if [ -d "$DESKTOP_DIR/build" ]; then
    git add "$DESKTOP_DIR/build"
  fi
  if [ -f "$DESKTOP_DIR/frontend/package.json" ]; then
    git add "$DESKTOP_DIR/frontend/package.json"
  fi
  if [ -f "$DESKTOP_DIR/frontend/package-lock.json" ]; then
    git add "$DESKTOP_DIR/frontend/package-lock.json"
  fi

  # 提交
  git commit -m "chore: bump version to $VERSION"

  echo -e "${GREEN}✅ 变更已提交${NC}\n"

  # 打 tag (tag 推送后将触发 release 流水线)
  echo -e "${YELLOW}🏷️  创建 tag v$VERSION...${NC}"
  git tag -a "v$VERSION" -m "Release v$VERSION"
  echo -e "${GREEN}✅ tag v$VERSION 已创建${NC}\n"

  # 询问是否推送
  echo -e "${YELLOW}是否推送到远程仓库 (将触发发布流水线)? (y/n)${NC}"
  read -r PUSH_CONFIRM

  if [ "$PUSH_CONFIRM" = "y" ] || [ "$PUSH_CONFIRM" = "Y" ]; then
    echo -e "\n${YELLOW}🚀 推送到远程仓库...${NC}"
    git push
    git push origin "v$VERSION"
    echo -e "${GREEN}✅ 已推送提交和 tag${NC}\n"

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}🎉 版本发布已触发！${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}📌 新版本: ${VERSION}${NC}"
    echo -e "${YELLOW}🔨 GitHub Actions 发布流水线将依次执行:${NC}"
    echo -e "   1. 版本校验 (tag 与 VERSION 文件一致)"
    echo -e "   2. 构建镜像 (linux/amd64) + Trivy 安全扫描:"
    echo -e "      - shanhee/easyssh:v${VERSION}"
    echo -e "      - shanhee/easyssh:latest"
    echo -e "   3. 构建 Windows 桌面端 (x86)"
    echo -e "   4. 创建 GitHub Release (附桌面端 zip)"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    echo -e "${YELLOW}💡 查看发布进度:${NC}"
    echo -e "   https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions\n"
  else
    echo -e "${YELLOW}⏭️  跳过推送${NC}\n"
    echo -e "${BLUE}💡 稍后可以手动推送 (推送 tag 后将触发发布流水线):${NC}"
    echo -e "   git push"
    echo -e "   git push origin v$VERSION\n"
  fi
else
  echo -e "${YELLOW}⏭️  跳过提交${NC}\n"
  echo -e "${BLUE}💡 稍后可以手动提交并发版:${NC}"
  echo -e "   git add VERSION README.md web/package.json desktop/EasySSHDesktop"
  echo -e "   git commit -m \"chore: bump version to $VERSION\""
  echo -e "   git tag -a v$VERSION -m \"Release v$VERSION\""
  echo -e "   git push && git push origin v$VERSION\n"
fi

echo -e "${GREEN}✨ 完成！${NC}"
