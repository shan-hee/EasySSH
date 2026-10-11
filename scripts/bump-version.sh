#!/bin/bash

# 发布版本入口：统一应用版本，并校验/同步内置数据库迁移版本。
# 不连接数据库，不执行 SQL，不构建、不运行测试。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ "$#" -ne 1 ] || [ -z "${1:-}" ]; then
  echo "用法: $0 <x.y.z>"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "错误：需要 Node.js，请先安装项目要求的 Node.js 版本。"
  exit 1
fi
VERSION="$1"

# 检查发生在任何写入之前；数据库编号由四套完整 SQL 链决定。
# 已发布 SQL 必须保持不变，不把应用版本号写入数据库版本表。
node scripts/release-version.mjs --prepare "$VERSION"

RELEASE_PATHS=(VERSION README.md web/package.json
  desktop/EasySSHDesktop/build
  desktop/EasySSHDesktop/frontend/package.json
  desktop/EasySSHDesktop/desktopversion.go
  shared/dbmigration/migrate.go)
for file in web/package-lock.json desktop/EasySSHDesktop/frontend/package-lock.json; do
  if [ -f "$file" ]; then RELEASE_PATHS+=("$file"); fi
done

git --no-pager diff --stat -- "${RELEASE_PATHS[@]}"
echo "版本文件已更新。应用版本: $VERSION；数据库版本已根据迁移文件校验。"
echo "是否提交上述版本文件并创建 tag v$VERSION? (y/n)"
read -r CONFIRM || CONFIRM=n
if [[ "$CONFIRM" != y && "$CONFIRM" != Y ]]; then
  echo "已保留版本文件改动，未提交、未创建标签、未推送。"
  echo "确认后可手动提交；发布前可执行 node scripts/release-version.mjs --check。"
  exit 0
fi

# 确认期间若有编辑，再检查一次。业务代码和迁移 SQL 必须已在之前提交。
node scripts/release-version.mjs --release "$VERSION"
if ! git diff --cached --quiet; then
  echo "暂存区在版本更新期间发生变化；请检查后手动提交，未创建标签。"
  exit 1
fi
# Require a clean remainder before staging so failed preflight does not change the index.
REMAINDER=$(git status --porcelain -- .   ':(exclude)VERSION' ':(exclude)README.md' ':(exclude)web/package.json'   ':(exclude)web/package-lock.json' ':(exclude)desktop/EasySSHDesktop/build'   ':(exclude)desktop/EasySSHDesktop/frontend/package.json'   ':(exclude)desktop/EasySSHDesktop/frontend/package-lock.json'   ':(exclude)desktop/EasySSHDesktop/desktopversion.go'   ':(exclude)shared/dbmigration/migrate.go')
if [ -n "$REMAINDER" ]; then
  echo "版本更新期间出现其他代码改动；请先检查并提交，未创建标签。"
  printf '%s\n' "$REMAINDER"
  exit 1
fi

git add -- "${RELEASE_PATHS[@]}"
git commit -m "chore: bump version to $VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"
echo "已创建本地提交和标签 v$VERSION。"
echo "是否推送到 origin（将触发现有发布流水线）? (y/n)"
read -r PUSH_CONFIRM || PUSH_CONFIRM=n
if [[ "$PUSH_CONFIRM" == y || "$PUSH_CONFIRM" == Y ]]; then
  BRANCH=$(git branch --show-current)
  # Publish the matching branch commit and tag together, or neither.
  git push --atomic origin "HEAD:refs/heads/$BRANCH" "refs/tags/v$VERSION"
  echo "已推送提交和标签；现有 GitHub Actions 发布流水线将继续执行。"
else
  echo "未推送。稍后可手动推送当前分支及 v$VERSION 标签。"
fi
