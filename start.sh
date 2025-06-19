#!/bin/sh

# 优化的启动脚本
echo "Starting EasySSH services..."

# 检查权限和创建必要目录
echo "Preparing environment..."

# 确保目录存在并设置正确权限
mkdir -p /app/server/logs /app/server/data
chown -R appuser:appuser /app/server/logs /app/server/data
chmod 755 /app/server/logs /app/server/data

# 尝试创建日志文件
touch /app/server/logs/app.log 2>/dev/null || echo "Warning: Cannot create log file, will use stdout"
chown appuser:appuser /app/server/logs/app.log 2>/dev/null || true

# 启动后端服务
echo "Starting backend service..."
cd /app/server
su appuser -c "node index.js" &
BACKEND_PID=$!

# 启动 nginx
echo "Starting nginx..."
# 确保nginx目录存在且有正确权限
mkdir -p /var/log/nginx /var/cache/nginx /var/lib/nginx /run/nginx
# 启动nginx
nginx -g "daemon off;" &
NGINX_PID=$!

# 健康检查函数
health_check() {
    # 检查后端服务
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        echo "Backend service died, restarting..."
        cd /app/server
        node index.js &
        BACKEND_PID=$!
    fi

    # 检查nginx服务
    if ! kill -0 $NGINX_PID 2>/dev/null; then
        echo "Nginx service died, restarting..."
        nginx -g "daemon off;" &
        NGINX_PID=$!
    fi
}

# 等待信号
wait_for_signal() {
    echo "Services started. PID: Backend=$BACKEND_PID, Nginx=$NGINX_PID"
    echo "Press Ctrl+C to stop services"

    # 捕获信号
    trap 'echo "Stopping services..."; kill $BACKEND_PID $NGINX_PID 2>/dev/null; exit 0' TERM INT

    # 定期健康检查
    while true; do
        sleep 30
        health_check
    done
}

wait_for_signal
