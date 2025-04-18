#!/bin/bash

# EasySSH监控服务一键卸载脚本
# 版本：1.0
# 描述：此脚本用于完全卸载EasySSH监控服务及其所有相关文件

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

# 检查是否以root权限运行
if [ "$EUID" -ne 0 ]; then
  print_red "请以root权限运行此脚本（使用sudo）"
  exit 1
fi

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
print_yellow "步骤4：删除监控程序目录..."
if [ -d /opt/easyssh-monitor ]; then
    rm -rf /opt/easyssh-monitor
    print_green "监控程序目录已删除"
else
    print_yellow "监控程序目录不存在，继续卸载流程"
fi

# 步骤5：检查端口占用情况
print_yellow "步骤5：检查端口占用情况..."
if netstat -tulpn | grep -q ":9528 "; then
    print_red "警告：端口9528仍被占用，可能需要手动处理"
    netstat -tulpn | grep ":9528 "
else
    print_green "端口9528已释放"
fi

# 步骤6：尝试删除防火墙规则（适用于多种系统）
print_yellow "步骤6：清理防火墙规则..."

# 检测防火墙类型并尝试删除规则
if command -v ufw &> /dev/null; then
    print_yellow "检测到ufw防火墙，尝试删除规则..."
    ufw delete allow 9528/tcp &> /dev/null
    print_green "已尝试删除ufw规则"
fi

if command -v firewall-cmd &> /dev/null; then
    print_yellow "检测到firewalld防火墙，尝试删除规则..."
    firewall-cmd --permanent --remove-port=9528/tcp &> /dev/null
    firewall-cmd --reload &> /dev/null
    print_green "已尝试删除firewalld规则"
fi

if command -v iptables &> /dev/null; then
    print_yellow "尝试清理iptables规则..."
    iptables -D INPUT -p tcp --dport 9528 -j ACCEPT &> /dev/null
    print_green "已尝试删除iptables规则"
fi

echo ""
print_green "=== EasySSH监控服务卸载完成 ==="
print_green "所有相关服务、文件和配置均已移除"
echo ""

# 最终确认
if systemctl is-active --quiet easyssh-monitor || [ -d /opt/easyssh-monitor ] || [ -f /etc/systemd/system/easyssh-monitor.service ]; then
    print_red "警告：检测到可能存在未完全删除的组件，请检查并手动处理"
else
    print_green "验证通过：未检测到残留组件"
fi

exit 0 