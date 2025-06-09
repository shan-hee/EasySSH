#!/bin/sh

# 启动脚本
echo "Starting EasySSH services..."

# 启动后端服务
echo "Starting backend service..."
cd /app/server
node index.js &
BACKEND_PID=$!

# 启动 nginx
echo "Starting nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

# 等待信号
wait_for_signal() {
    echo "Services started. PID: Backend=$BACKEND_PID, Nginx=$NGINX_PID"
    echo "Press Ctrl+C to stop services"
    
    # 捕获信号
    trap 'echo "Stopping services..."; kill $BACKEND_PID $NGINX_PID; exit 0' TERM INT
    
    # 等待进程
    wait
}

wait_for_signal
