#!/bin/sh

# 优化的启动脚本
echo "Starting EasySSH services..."

# 检查权限和创建必要目录
echo "Preparing environment..."
mkdir -p /app/server/logs /app/server/data
touch /app/server/logs/app.log

# 启动后端服务
echo "Starting backend service..."
cd /app/server
node index.js &
BACKEND_PID=$!

# 启动 nginx（非root模式）
echo "Starting nginx..."
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
