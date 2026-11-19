#!/bin/bash

# 发版入口：校验后在当前提交创建 vX.Y.Z 标签并推送，推送触发 .github/workflows/release.yml。
# 不修改任何文件、不提交、不构建；版本号只来自标签。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TAG="${1:-}"
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "用法: $0 vX.Y.Z"
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净；请先提交或清理改动，避免标签遗漏代码。"
  exit 1
fi
BRANCH=$(git branch --show-current)
if [ -z "$BRANCH" ]; then
  echo "请先切换到发布分支，不要在 detached HEAD 上发版。"
  exit 1
fi

# 标签必须指向远端分支上已有的提交，否则 Release 构建的代码与分支历史不一致。
git fetch --quiet --tags origin "$BRANCH"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH")" ]; then
  echo "HEAD 与 origin/$BRANCH 不一致；请先推送或同步分支。"
  exit 1
fi

node scripts/release-version.mjs release "${TAG#v}"

echo "将在 $(git log -1 --format='%h %s') 上创建并推送 $TAG（触发发布流水线）。确认? (y/n)"
read -r CONFIRM || CONFIRM=n
if [[ "$CONFIRM" != y && "$CONFIRM" != Y ]]; then
  echo "已取消，未创建标签。"
  exit 0
fi

git tag -a "$TAG" -m "Release $TAG"
git push origin "refs/tags/$TAG"
echo "已推送 $TAG。"
