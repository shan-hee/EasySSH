#!/bin/sh
set -e

# 以 root 启动时修正挂载目录属主后降权；用户已通过 user: 指定非 root 时直接运行。
# 宿主机 bind mount 目录由 Docker 自动创建时属主为 root，应用用户无法写入。
if [ "$(id -u)" = "0" ]; then
  for dir in /app/data /app/backups /app/instance-state; do
    find "$dir" \! -user appuser -exec chown appuser:appuser {} +
  done
  exec su-exec appuser "$@"
fi

exec "$@"
