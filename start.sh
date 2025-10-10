#!/bin/sh

set -e
echo "Starting EasySSH services..."

# 确保目录存在并设置权限
mkdir -p /app/server/logs /app/server/data
chown -R appuser:appuser /app/server/logs /app/server/data
chmod 755 /app/server/logs /app/server/data

# 尝试创建日志文件（失败则降级stdout）
touch /app/server/logs/app.log 2>/dev/null || echo "Warning: Cannot create log file, using stdout"
chown appuser:appuser /app/server/logs/app.log 2>/dev/null || true

echo "Starting backend service..."
cd /app/server
su appuser -c "NODE_ENV=production DOTENV_CONFIG_PATH=/app/.env node -r dotenv/config dist/index.js" &
BACKEND_PID=$!

echo "Starting nginx..."
mkdir -p /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx
nginx -g "daemon off;" &
NGINX_PID=$!

# 健康检查与守护
health_check() {
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend service died, restarting..."
    su appuser -c "NODE_ENV=production DOTENV_CONFIG_PATH=/app/.env node -r dotenv/config dist/index.js" &
    BACKEND_PID=$!
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "Nginx service died, restarting..."
    nginx -g "daemon off;" &
    NGINX_PID=$!
  fi
}

trap 'echo "Stopping services..."; kill $BACKEND_PID $NGINX_PID 2>/dev/null; exit 0' TERM INT

echo "Services started. PIDs: backend=$BACKEND_PID, nginx=$NGINX_PID"

while true; do
  sleep 30
  health_check
done

