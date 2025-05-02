#!/bin/bash

# EasySSH监控服务一键卸载脚本
# 版本：1.3
# 描述：此脚本用于完全卸载EasySSH监控服务及其所有相关文件（无交互模式）
# 支持清理交换分区监控和网络速率监控等新增功能

# 输出彩色文本函数
print_green() {
    echo -e "\033[32m$1\033[0m"
}

print_red() {
    echo -e "\033[31m$1\033[0m"
}

print_yellow() {
    echo -e "\033[33m$1\033[0m"
}

print_blue() {
    echo -e "\033[34m$1\033[0m"
}

# 检查是否以root权限运行
if [ "$EUID" -ne 0 ]; then
  print_red "请以root权限运行此脚本（使用sudo）"
  exit 1
fi

# 清屏并显示卸载标题
clear
print_blue "================================================="
print_blue "       EasySSH监控服务 - 一键卸载工具           "
print_blue "       支持清理交换分区和网络速率监控           "
print_blue "================================================="
echo ""

# 无需确认，直接开始卸载
print_yellow "开始执行一键卸载，将自动删除所有EasySSH监控服务组件"
echo ""
print_yellow "=== 开始卸载EasySSH监控服务 ==="
echo ""

# 步骤1：停止服务
print_yellow "步骤1：停止EasySSH监控服务..."
if systemctl is-active --quiet easyssh-monitor; then
    systemctl stop easyssh-monitor
    print_green "服务已停止"
else
    print_yellow "服务未在运行，继续卸载流程"
fi

# 步骤2：禁用服务自启动
print_yellow "步骤2：禁用服务自启动..."
if systemctl is-enabled --quiet easyssh-monitor; then
    systemctl disable easyssh-monitor
    print_green "服务自启动已禁用"
else
    print_yellow "服务未启用自启动，继续卸载流程"
fi

# 步骤3：删除服务文件
print_yellow "步骤3：删除系统服务文件..."
if [ -f /etc/systemd/system/easyssh-monitor.service ]; then
    rm -f /etc/systemd/system/easyssh-monitor.service
    print_green "服务文件已删除"
else
    print_yellow "服务文件不存在，继续卸载流程"
fi

# 删除软链接
if [ -f /etc/systemd/system/multi-user.target.wants/easyssh-monitor.service ]; then
    rm -f /etc/systemd/system/multi-user.target.wants/easyssh-monitor.service
    print_green "服务软链接已删除"
fi

# 重新加载systemd配置
print_yellow "重新加载systemd配置..."
systemctl daemon-reload
print_green "配置已重新加载"

# 步骤4：删除监控程序目录
print_yellow "步骤4：删除监控程序目录及相关文件..."
# 删除主程序目录
if [ -d /opt/easyssh-monitor ]; then
    rm -rf /opt/easyssh-monitor
    print_green "监控程序主目录已删除"
else
    print_yellow "监控程序主目录不存在，继续卸载流程"
fi

# 删除配置文件目录
if [ -d /etc/easyssh-monitor ]; then
    rm -rf /etc/easyssh-monitor
    print_green "配置文件目录已删除"
else
    print_yellow "配置文件目录不存在，继续卸载流程"
fi

# 删除日志文件
if [ -d /var/log/easyssh-monitor ]; then
    rm -rf /var/log/easyssh-monitor
    print_green "日志文件目录已删除"
else
    print_yellow "日志文件目录不存在，继续卸载流程"
fi

# 删除缓存目录
if [ -d /var/cache/easyssh-monitor ]; then
    rm -rf /var/cache/easyssh-monitor
    print_green "缓存目录已删除"
else
    print_yellow "缓存目录不存在，继续卸载流程"
fi

# 删除可能存在的临时文件
rm -f /tmp/easyssh-monitor-*.tmp 2>/dev/null
rm -f /tmp/easyssh-monitor-*.lock 2>/dev/null
rm -f /tmp/config.json 2>/dev/null
rm -f /tmp/monitor.js 2>/dev/null
rm -f /tmp/package.json 2>/dev/null
rm -f /tmp/easyssh-monitor.service 2>/dev/null
print_green "临时文件已清理"

# 步骤5：检查端口占用情况并尝试释放
print_yellow "步骤5：检查端口占用情况并尝试释放..."
for port in 9527; do
    pid=$(lsof -ti :$port 2>/dev/null)
    if [ -n "$pid" ]; then
        print_yellow "发现端口 $port 被进程 $pid 占用，尝试终止..."
        kill -9 $pid 2>/dev/null
        sleep 1
        if lsof -ti :$port &>/dev/null; then
            print_red "警告：无法释放端口 $port，可能需要手动处理"
        else
            print_green "端口 $port 已成功释放"
        fi
    else
        print_green "端口 $port 未被占用"
    fi
done

# 步骤6：清理防火墙规则
print_yellow "步骤6：清理防火墙规则..."

# 检测防火墙类型并尝试删除规则
if command -v ufw &> /dev/null; then
    print_yellow "检测到ufw防火墙，尝试删除规则..."
    ufw delete allow 9527/tcp &> /dev/null
    print_green "已尝试删除ufw规则"
fi

if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
    print_yellow "检测到firewalld防火墙，尝试删除规则..."
    firewall-cmd --permanent --remove-port=9527/tcp &> /dev/null
    firewall-cmd --reload &> /dev/null
    print_green "已尝试删除firewalld规则"
fi

if command -v iptables &> /dev/null; then
    print_yellow "尝试清理iptables规则..."
    iptables -D INPUT -p tcp --dport 9527 -j ACCEPT &> /dev/null
    print_green "已尝试删除iptables规则"
fi

# 步骤7：清理定时任务
print_yellow "步骤7：清理定时任务..."
if command -v crontab &> /dev/null; then
    # 移除包含easyssh-monitor的crontab项
    (crontab -l 2>/dev/null | grep -v "easyssh-monitor") | crontab -
    print_green "已清理crontab任务"
fi

# 步骤8：删除可能的用户和用户组
print_yellow "步骤8：删除相关用户和用户组..."
if id "easyssh" &>/dev/null; then
    userdel -rf easyssh 2>/dev/null
    print_green "已删除easyssh用户"
fi
if getent group "easyssh" &>/dev/null; then
    groupdel easyssh 2>/dev/null
    print_green "已删除easyssh用户组"
fi

# 步骤9：清理Node.js缓存和npm全局包（如果不影响其他应用）
print_yellow "步骤9：清理Node.js相关缓存..."
if [ -d ~/.npm/easyssh-monitor ]; then
    rm -rf ~/.npm/easyssh-monitor 2>/dev/null
    print_green "已清理npm缓存"
fi

# 步骤10：清理网络监控和交换分区监控相关的临时文件
print_yellow "步骤10：清理网络监控和交换分区监控临时文件..."
# 删除可能存在的网络状态缓存文件
rm -f /tmp/network_stats_*.json 2>/dev/null
rm -f /tmp/swap_stats_*.json 2>/dev/null
rm -f /tmp/easyssh_lastNetworkStats.json 2>/dev/null
print_green "网络和交换分区监控临时文件已清理"

# 最终清理和验证
echo ""
print_blue "================================================="
print_green "=== EasySSH监控服务卸载完成 ==="
print_blue "================================================="
echo ""

# 最终确认
failed=0
if systemctl is-active --quiet easyssh-monitor; then
    print_red "警告：服务仍在运行"
    failed=1
fi

if [ -d /opt/easyssh-monitor ] || [ -d /etc/easyssh-monitor ] || [ -f /etc/systemd/system/easyssh-monitor.service ]; then
    print_red "警告：检测到可能存在未完全删除的组件，请检查并手动处理"
    failed=1
fi

if lsof -ti :9527 &>/dev/null; then
    print_red "警告：监控服务端口仍被占用"
    failed=1
fi

# 步骤11：自动删除安装和卸载脚本
print_yellow "步骤11：清理安装和卸载脚本..."

# 获取当前脚本的绝对路径
SCRIPT_PATH="$(readlink -f "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
SCRIPT_NAME="$(basename "$SCRIPT_PATH")"

# 查找并删除安装脚本
INSTALL_SCRIPT_NAME="easyssh-monitor-install.sh"
INSTALL_SCRIPT="$SCRIPT_DIR/$INSTALL_SCRIPT_NAME"

if [ -f "$INSTALL_SCRIPT" ]; then
    rm -f "$INSTALL_SCRIPT"
    print_green "安装脚本已删除: $INSTALL_SCRIPT"
elif [ -f "./$INSTALL_SCRIPT_NAME" ]; then
    rm -f "./$INSTALL_SCRIPT_NAME"
    print_green "安装脚本已删除: ./$INSTALL_SCRIPT_NAME"
else
    # 尝试查找系统中的安装脚本
    FOUND_INSTALL_SCRIPT=$(find /tmp /home /root -name "$INSTALL_SCRIPT_NAME" -type f 2>/dev/null | head -n 1)
    if [ -n "$FOUND_INSTALL_SCRIPT" ]; then
        rm -f "$FOUND_INSTALL_SCRIPT"
        print_green "安装脚本已删除: $FOUND_INSTALL_SCRIPT"
    else
        print_yellow "未找到安装脚本"
    fi
fi

# 创建自删除函数
create_self_destruct() {
    print_yellow "卸载脚本将在完成后自动删除"
    
    # 创建临时清理脚本，确保使用独立名称避免冲突
    CLEANUP_SCRIPT="/tmp/cleanup_easyssh_${RANDOM}.sh"
    
    cat > "$CLEANUP_SCRIPT" << EOL
#!/bin/bash
# 等待原脚本退出
sleep 1
# 删除卸载脚本
if [ -f "$SCRIPT_PATH" ]; then
    rm -f "$SCRIPT_PATH"
fi
# 删除自身
rm -f "$CLEANUP_SCRIPT"
EOL
    
    chmod +x "$CLEANUP_SCRIPT"
    # 后台执行清理脚本
    nohup "$CLEANUP_SCRIPT" > /dev/null 2>&1 &
}

# 显示最终结果
if [ $failed -eq 0 ]; then
    print_green "验证通过：未检测到残留组件"
    print_blue "================================================="
    print_green "EasySSH监控服务及其所有相关文件已被完全删除"
    print_green "包括交换分区监控和网络速率监控相关的组件"
    print_blue "================================================="
else
    print_yellow "卸载过程完成，但存在一些警告，请检查上述信息"
fi

# 启动自删除过程
create_self_destruct

exit 0 