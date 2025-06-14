#!/bin/bash

# EasySSH轻量级监控客户端卸载脚本
# 版本：2.0 - 适配客户端主动连接架构
# 描述：卸载EasySSH轻量级监控客户端及相关文件

echo "正在卸载EasySSH监控客户端..."

# 停止并禁用服务
if systemctl is-active --quiet easyssh-monitor 2>/dev/null; then
    systemctl stop easyssh-monitor
    echo "✓ 服务已停止"
fi

if systemctl is-enabled --quiet easyssh-monitor 2>/dev/null; then
    systemctl disable easyssh-monitor
    echo "✓ 服务自启动已禁用"
fi

# 删除服务文件
if [ -f /etc/systemd/system/easyssh-monitor.service ]; then
    rm -f /etc/systemd/system/easyssh-monitor.service
    echo "✓ 服务文件已删除"
fi

# 删除服务软链接
rm -f /etc/systemd/system/multi-user.target.wants/easyssh-monitor.service 2>/dev/null

# 重新加载systemd配置
systemctl daemon-reload

# 删除程序目录
if [ -d /opt/easyssh-monitor ]; then
    rm -rf /opt/easyssh-monitor
    echo "✓ 监控程序目录已删除"
fi

# 清理临时文件
rm -f /tmp/config.json 2>/dev/null
rm -f /tmp/monitor.js 2>/dev/null
rm -f /tmp/package.json 2>/dev/null
rm -f /tmp/easyssh-monitor.service 2>/dev/null

# 清理定时任务
if command -v crontab &> /dev/null; then
    (crontab -l 2>/dev/null | grep -v "easyssh-monitor") | crontab - 2>/dev/null
fi

# 验证卸载结果
failed=0
if systemctl is-active --quiet easyssh-monitor; then
    echo "⚠️  警告：服务仍在运行"
    failed=1
fi

if [ -d /opt/easyssh-monitor ] || [ -f /etc/systemd/system/easyssh-monitor.service ]; then
    echo "⚠️  警告：检测到残留组件"
    failed=1
fi

# 清理安装脚本
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
INSTALL_SCRIPT="$SCRIPT_DIR/easyssh-monitor-install.sh"
if [ -f "$INSTALL_SCRIPT" ]; then
    rm -f "$INSTALL_SCRIPT"
fi

# 自删除函数
cleanup_self() {
    SCRIPT_PATH="$(readlink -f "$0")"
    CLEANUP_SCRIPT="/tmp/cleanup_easyssh_${RANDOM}.sh"

    cat > "$CLEANUP_SCRIPT" << 'EOL'
#!/bin/bash
sleep 1
rm -f "$1" 2>/dev/null
rm -f "$0" 2>/dev/null
EOL

    chmod +x "$CLEANUP_SCRIPT"
    nohup "$CLEANUP_SCRIPT" "$SCRIPT_PATH" > /dev/null 2>&1 &
}

# 显示结果
if [ $failed -eq 0 ]; then
    echo "✅ EasySSH监控客户端卸载完成"
else
    echo "⚠️  卸载完成，但存在警告"
fi

# 启动自删除
cleanup_self

exit 0