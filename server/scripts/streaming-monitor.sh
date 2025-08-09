#!/bin/bash
# EasySSH 流式监控采集脚本
# 优化版：单会话长连接，直接读取 /proc 和 /sys，输出 NDJSON

# 设置环境变量，避免 locale 问题
export LC_ALL=C
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

# 配置参数
INTERVAL=${1:-1}  # 采集间隔，默认1秒
DEBUG=${2:-0}     # 调试模式

# 错误处理
set -o pipefail
# 只在非调试模式下重定向stderr
[ $DEBUG -eq 0 ] && exec 2>/dev/null

# 全局变量
PREV_CPU_TOTAL=0
PREV_CPU_IDLE=0
PREV_NET_RX=0
PREV_NET_TX=0
PREV_DISK_READ=0
PREV_DISK_WRITE=0
PREV_TIMESTAMP=0

# 当前网络速度（全局变量）
CURRENT_RX_SPEED=0
CURRENT_TX_SPEED=0

# 静态信息缓存
STATIC_INFO_CACHED=0
STATIC_INFO=""

# 获取主网卡接口
get_primary_interface() {
    # 优先通过默认路由获取主网卡
    local iface=$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -1)
    if [ -z "$iface" ]; then
        # 降级方案：查找第一个非lo接口
        iface=$(ls /sys/class/net/ | grep -v lo | head -1)
    fi
    echo "${iface:-eth0}"
}

# 获取主磁盘设备
get_primary_disk() {
    # 获取根分区对应的磁盘设备
    local disk=$(df / | tail -1 | awk '{print $1}' | sed 's/[0-9]*$//' | sed 's|/dev/||')
    if [ -z "$disk" ]; then
        # 降级方案
        disk=$(ls /sys/block/ | grep -E '^(sd|nvme|vd)' | head -1)
    fi
    echo "${disk:-sda}"
}

# 获取CPU信息（优化版差分算法）
get_cpu_info() {
    if [ -f /proc/stat ]; then
        local cpu_line=$(head -1 /proc/stat)
        local cpu_values=($cpu_line)

        local user=${cpu_values[1]:-0}
        local nice=${cpu_values[2]:-0}
        local system=${cpu_values[3]:-0}
        local idle=${cpu_values[4]:-0}
        local iowait=${cpu_values[5]:-0}
        local irq=${cpu_values[6]:-0}
        local softirq=${cpu_values[7]:-0}
        local steal=${cpu_values[8]:-0}
        local guest=${cpu_values[9]:-0}
        local guest_nice=${cpu_values[10]:-0}

        # 计算总时间和空闲时间（包含guest时间）
        local total=$((user + nice + system + idle + iowait + irq + softirq + steal + guest + guest_nice))
        local idle_total=$((idle + iowait))
        local usage=0

        # 精确的CPU使用率差分算法
        if [ $PREV_CPU_TOTAL -gt 0 ]; then
            local total_diff=$((total - PREV_CPU_TOTAL))
            local idle_diff=$((idle_total - PREV_CPU_IDLE))

            if [ $total_diff -gt 0 ]; then
                # 使用浮点运算提高精度
                usage=$(awk "BEGIN {printf \"%.1f\", ($total_diff - $idle_diff) * 100.0 / $total_diff}")
                # 转换为整数（四舍五入）
                usage=$(awk "BEGIN {printf \"%.0f\", $usage}")
            fi
        else
            # 第一次运行时，使用vmstat获取即时CPU使用率
            local vmstat_usage=$(vmstat 1 2 2>/dev/null | tail -1 | awk '{print 100 - $15}' 2>/dev/null || echo "0")
            usage=$(awk "BEGIN {printf \"%.0f\", $vmstat_usage}")
        fi

        PREV_CPU_TOTAL=$total
        PREV_CPU_IDLE=$idle_total

        # 获取CPU核心数和型号（缓存）
        local cores=$(nproc 2>/dev/null || echo "1")
        local cpu_model=""
        if [ -z "$CPU_MODEL_CACHED" ]; then
            cpu_model=$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null | sed 's/^[ \t]*//')
            CPU_MODEL_CACHED="${cpu_model:-Unknown}"
        fi

        # 获取负载平均值
        local load_avg=""
        if [ -f /proc/loadavg ]; then
            load_avg=$(awk '{printf "\"load1\":%.2f,\"load5\":%.2f,\"load15\":%.2f", $1, $2, $3}' /proc/loadavg)
        else
            load_avg="\"load1\":0,\"load5\":0,\"load15\":0"
        fi

        echo "\"cpu\":{\"usage\":$usage,\"cores\":$cores,\"model\":\"$CPU_MODEL_CACHED\",\"loadAverage\":{$load_avg}}"
    else
        echo "\"cpu\":{\"usage\":0,\"cores\":1,\"model\":\"Unknown\",\"loadAverage\":{\"load1\":0,\"load5\":0,\"load15\":0}}"
    fi
}

# 获取内存信息
get_memory_info() {
    if [ -f /proc/meminfo ]; then
        local mem_total=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
        local mem_available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
        local mem_free=$(awk '/MemFree:/ {print $2}' /proc/meminfo)
        local buffers=$(awk '/Buffers:/ {print $2}' /proc/meminfo)
        local cached=$(awk '/^Cached:/ {print $2}' /proc/meminfo)
        
        # 转换为字节
        mem_total=$((mem_total * 1024))
        
        # 优先使用 MemAvailable，降级使用计算值
        if [ -n "$mem_available" ] && [ "$mem_available" -gt 0 ]; then
            local mem_used=$((mem_total - mem_available * 1024))
        else
            local mem_used=$((mem_total - (mem_free + buffers + cached) * 1024))
        fi
        
        local mem_usage_pct=0
        if [ $mem_total -gt 0 ]; then
            mem_usage_pct=$((mem_used * 100 / mem_total))
        fi
        
        echo "\"memory\":{\"total\":$mem_total,\"used\":$mem_used,\"usedPercentage\":$mem_usage_pct}"
    else
        echo "\"memory\":{\"total\":0,\"used\":0,\"usedPercentage\":0}"
    fi
}

# 获取交换分区信息
get_swap_info() {
    if [ -f /proc/meminfo ]; then
        local swap_total=$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)
        local swap_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
        
        swap_total=$((swap_total * 1024))
        swap_free=$((swap_free * 1024))
        local swap_used=$((swap_total - swap_free))
        
        local swap_usage_pct=0
        if [ $swap_total -gt 0 ]; then
            swap_usage_pct=$((swap_used * 100 / swap_total))
        fi
        
        echo "\"swap\":{\"total\":$swap_total,\"used\":$swap_used,\"usedPercentage\":$swap_usage_pct}"
    else
        echo "\"swap\":{\"total\":0,\"used\":0,\"usedPercentage\":0}"
    fi
}

# 获取磁盘信息
get_disk_info() {
    # 使用 df 获取根分区信息
    local disk_info=$(df -B1 / 2>/dev/null | tail -1)
    if [ -n "$disk_info" ]; then
        local disk_values=($disk_info)
        local total=${disk_values[1]:-0}
        local used=${disk_values[2]:-0}
        local available=${disk_values[3]:-0}
        
        local usage_pct=0
        if [ $total -gt 0 ]; then
            usage_pct=$((used * 100 / total))
        fi
        
        echo "\"disk\":{\"total\":$total,\"used\":$used,\"free\":$available,\"usedPercentage\":$usage_pct}"
    else
        echo "\"disk\":{\"total\":0,\"used\":0,\"free\":0,\"usedPercentage\":0}"
    fi
}

# 更新网络缓存（在主shell中执行）
update_network_cache() {
    local iface=$(get_primary_interface)
    local rx_bytes=0
    local tx_bytes=0

    # 读取网络统计信息
    if [ -f "/sys/class/net/$iface/statistics/rx_bytes" ]; then
        rx_bytes=$(cat "/sys/class/net/$iface/statistics/rx_bytes" 2>/dev/null || echo "0")
        tx_bytes=$(cat "/sys/class/net/$iface/statistics/tx_bytes" 2>/dev/null || echo "0")
    fi

    # 使用高精度时间戳（毫秒）- 兼容性改进
    local current_time_ms
    if command -v date >/dev/null 2>&1 && date +%s%3N >/dev/null 2>&1; then
        current_time_ms=$(date +%s%3N)
    else
        # 降级到秒级精度
        current_time_ms=$(($(date +%s) * 1000))
    fi

    # 精确的网络速率计算
    [ $DEBUG -eq 1 ] && echo "# NET DEBUG: Checking PREV_TIMESTAMP=$PREV_TIMESTAMP" >&2
    if [ $PREV_TIMESTAMP -gt 0 ]; then
        local time_diff_ms=$((current_time_ms - PREV_TIMESTAMP))
        local rx_diff=$((rx_bytes - PREV_NET_RX))
        local tx_diff=$((tx_bytes - PREV_NET_TX))

        if [ $time_diff_ms -gt 0 ]; then
            # 计算字节/秒，使用毫秒精度
            CURRENT_RX_SPEED=$(( rx_diff * 1000 / time_diff_ms ))
            CURRENT_TX_SPEED=$(( tx_diff * 1000 / time_diff_ms ))

            # 防止负值（可能由于计数器重置）
            [ $CURRENT_RX_SPEED -lt 0 ] && CURRENT_RX_SPEED=0
            [ $CURRENT_TX_SPEED -lt 0 ] && CURRENT_TX_SPEED=0

            # 调试信息（强制输出到stdout用于调试）
            if [ $DEBUG -eq 1 ]; then
                echo "# NET DEBUG: time_diff=${time_diff_ms}ms, rx_diff=${rx_diff}, tx_diff=${tx_diff}, rx_speed=${CURRENT_RX_SPEED}B/s, tx_speed=${CURRENT_TX_SPEED}B/s" >&2
                echo "# NET DEBUG: PREV_NET_RX=${PREV_NET_RX}, rx_bytes=${rx_bytes}, PREV_TIMESTAMP=${PREV_TIMESTAMP}, current_time_ms=${current_time_ms}" >&2
            fi
        fi
    else
        # 第一次运行时，初始化历史数据但速度设为0（这是正常的）
        CURRENT_RX_SPEED=0
        CURRENT_TX_SPEED=0
        [ $DEBUG -eq 1 ] && echo "# NET DEBUG: First run, initializing with 0 speed" >&2
    fi

    # 更新缓存
    PREV_NET_RX=$rx_bytes
    PREV_NET_TX=$tx_bytes
    PREV_TIMESTAMP=$current_time_ms

    # 调试：显示更新后的缓存值
    [ $DEBUG -eq 1 ] && echo "# NET DEBUG: Updated cache - PREV_NET_RX=$PREV_NET_RX, PREV_NET_TX=$PREV_NET_TX, PREV_TIMESTAMP=$PREV_TIMESTAMP" >&2
}

# 获取网络信息JSON（使用缓存的速度值）
get_network_info_json() {
    local iface=$(get_primary_interface)
    local rx_packets=0
    local tx_packets=0

    # 读取数据包统计
    if [ -f "/sys/class/net/$iface/statistics/rx_packets" ]; then
        rx_packets=$(cat "/sys/class/net/$iface/statistics/rx_packets" 2>/dev/null || echo "0")
        tx_packets=$(cat "/sys/class/net/$iface/statistics/tx_packets" 2>/dev/null || echo "0")
    fi

    # 获取网络接口状态
    local link_speed=0
    local link_state="unknown"
    if [ -f "/sys/class/net/$iface/speed" ]; then
        link_speed=$(cat "/sys/class/net/$iface/speed" 2>/dev/null || echo "0")
        # 转换为bps
        link_speed=$((link_speed * 1000000))
    fi

    if [ -f "/sys/class/net/$iface/operstate" ]; then
        link_state=$(cat "/sys/class/net/$iface/operstate" 2>/dev/null || echo "unknown")
    fi

    echo "\"network\":{\"interface\":\"$iface\",\"total_rx_speed\":${CURRENT_RX_SPEED:-0},\"total_tx_speed\":${CURRENT_TX_SPEED:-0},\"rx_packets\":$rx_packets,\"tx_packets\":$tx_packets,\"link_speed\":$link_speed,\"link_state\":\"$link_state\"}"
}

# 获取网络信息（精确速率计算）- 保留原函数以防兼容性问题
get_network_info() {
    local iface=$(get_primary_interface)
    local rx_bytes=0
    local tx_bytes=0
    local rx_packets=0
    local tx_packets=0

    # 读取网络统计信息
    if [ -f "/sys/class/net/$iface/statistics/rx_bytes" ]; then
        rx_bytes=$(cat "/sys/class/net/$iface/statistics/rx_bytes" 2>/dev/null || echo "0")
        tx_bytes=$(cat "/sys/class/net/$iface/statistics/tx_bytes" 2>/dev/null || echo "0")
        rx_packets=$(cat "/sys/class/net/$iface/statistics/rx_packets" 2>/dev/null || echo "0")
        tx_packets=$(cat "/sys/class/net/$iface/statistics/tx_packets" 2>/dev/null || echo "0")
    fi

    # 使用高精度时间戳（毫秒）- 兼容性改进
    local current_time_ms
    if command -v date >/dev/null 2>&1 && date +%s%3N >/dev/null 2>&1; then
        current_time_ms=$(date +%s%3N)
    else
        # 降级到秒级精度
        current_time_ms=$(($(date +%s) * 1000))
    fi
    local rx_speed=0
    local tx_speed=0

    # 精确的网络速率计算
    [ $DEBUG -eq 1 ] && echo "# NET DEBUG: Checking PREV_TIMESTAMP=$PREV_TIMESTAMP" >&2
    if [ $PREV_TIMESTAMP -gt 0 ]; then
        local time_diff_ms=$((current_time_ms - PREV_TIMESTAMP))
        local rx_diff=$((rx_bytes - PREV_NET_RX))
        local tx_diff=$((tx_bytes - PREV_NET_TX))

        if [ $time_diff_ms -gt 0 ]; then
            # 计算字节/秒，使用毫秒精度
            rx_speed=$(( rx_diff * 1000 / time_diff_ms ))
            tx_speed=$(( tx_diff * 1000 / time_diff_ms ))

            # 防止负值（可能由于计数器重置）
            [ $rx_speed -lt 0 ] && rx_speed=0
            [ $tx_speed -lt 0 ] && tx_speed=0

            # 调试信息（强制输出到stdout用于调试）
            if [ $DEBUG -eq 1 ]; then
                echo "# NET DEBUG: time_diff=${time_diff_ms}ms, rx_diff=${rx_diff}, tx_diff=${tx_diff}, rx_speed=${rx_speed}B/s, tx_speed=${tx_speed}B/s" >&2
                echo "# NET DEBUG: PREV_NET_RX=${PREV_NET_RX}, rx_bytes=${rx_bytes}, PREV_TIMESTAMP=${PREV_TIMESTAMP}, current_time_ms=${current_time_ms}" >&2
            fi
        fi
    else
        # 第一次运行时，初始化历史数据但速度设为0（这是正常的）
        rx_speed=0
        tx_speed=0
        [ $DEBUG -eq 1 ] && echo "# NET DEBUG: First run, initializing with 0 speed" >&2
    fi

    # 更新缓存
    PREV_NET_RX=$rx_bytes
    PREV_NET_TX=$tx_bytes
    PREV_TIMESTAMP=$current_time_ms

    # 调试：显示更新后的缓存值
    [ $DEBUG -eq 1 ] && echo "# NET DEBUG: Updated cache - PREV_NET_RX=$PREV_NET_RX, PREV_NET_TX=$PREV_NET_TX, PREV_TIMESTAMP=$PREV_TIMESTAMP" >&2

    # 获取网络接口状态
    local link_speed=0
    local link_state="unknown"
    if [ -f "/sys/class/net/$iface/speed" ]; then
        link_speed=$(cat "/sys/class/net/$iface/speed" 2>/dev/null || echo "0")
        # 转换为bps
        link_speed=$((link_speed * 1000000))
    fi

    if [ -f "/sys/class/net/$iface/operstate" ]; then
        link_state=$(cat "/sys/class/net/$iface/operstate" 2>/dev/null || echo "unknown")
    fi

    echo "\"network\":{\"interface\":\"$iface\",\"total_rx_speed\":$rx_speed,\"total_tx_speed\":$tx_speed,\"rx_packets\":$rx_packets,\"tx_packets\":$tx_packets,\"link_speed\":$link_speed,\"link_state\":\"$link_state\"}"
}

# 获取静态系统信息（缓存5分钟）
get_static_info() {
    local current_time=$(date +%s)
    
    # 检查缓存是否有效（5分钟 = 300秒）
    if [ $STATIC_INFO_CACHED -gt 0 ] && [ $((current_time - STATIC_INFO_CACHED)) -lt 300 ]; then
        echo "$STATIC_INFO"
        return
    fi
    
    # 获取主机名
    local hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown")
    
    # 获取操作系统信息
    local os_name="Linux"
    local os_version="unknown"
    if [ -f /etc/os-release ]; then
        os_name=$(grep '^PRETTY_NAME=' /etc/os-release | cut -d'"' -f2 | head -1)
        os_version=$(grep '^VERSION=' /etc/os-release | cut -d'"' -f2 | head -1)
    fi
    
    # 获取架构
    local arch=$(uname -m 2>/dev/null || echo "unknown")
    
    # 获取运行时间
    local uptime=0
    if [ -f /proc/uptime ]; then
        uptime=$(awk '{print int($1)}' /proc/uptime)
    fi
    
    # 获取内网IP
    local internal_ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -1)
    if [ -z "$internal_ip" ]; then
        internal_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi
    
    STATIC_INFO="\"os\":{\"hostname\":\"$hostname\",\"platform\":\"Linux\",\"release\":\"$os_name\",\"arch\":\"$arch\",\"uptime\":$uptime},\"ip\":{\"internal\":\"${internal_ip:-unknown}\"}"
    STATIC_INFO_CACHED=$current_time
    
    echo "$STATIC_INFO"
}

# 获取PSI压力信息（如果支持）
get_psi_info() {
    local psi_data=""

    if [ -f /proc/pressure/cpu ]; then
        local cpu_pressure=$(awk '/avg10=/ {gsub(/avg10=/, ""); gsub(/%/, ""); print $2}' /proc/pressure/cpu 2>/dev/null | head -1)
        cpu_pressure=${cpu_pressure:-0}
        psi_data="\"cpu\":$cpu_pressure"
    fi

    if [ -f /proc/pressure/memory ]; then
        local mem_pressure=$(awk '/avg10=/ {gsub(/avg10=/, ""); gsub(/%/, ""); print $2}' /proc/pressure/memory 2>/dev/null | head -1)
        mem_pressure=${mem_pressure:-0}
        if [ -n "$psi_data" ]; then
            psi_data="$psi_data,\"memory\":$mem_pressure"
        else
            psi_data="\"memory\":$mem_pressure"
        fi
    fi

    if [ -f /proc/pressure/io ]; then
        local io_pressure=$(awk '/avg10=/ {gsub(/avg10=/, ""); gsub(/%/, ""); print $2}' /proc/pressure/io 2>/dev/null | head -1)
        io_pressure=${io_pressure:-0}
        if [ -n "$psi_data" ]; then
            psi_data="$psi_data,\"io\":$io_pressure"
        else
            psi_data="\"io\":$io_pressure"
        fi
    fi

    if [ -n "$psi_data" ]; then
        echo ",\"psi\":{$psi_data}"
    fi
}

# 获取容器信息（如果在容器中运行）
get_container_info() {
    local container_data=""

    # 检查是否在容器中
    local in_container=false
    if [ -f /.dockerenv ] || [ -f /proc/1/cgroup ] && grep -q docker /proc/1/cgroup 2>/dev/null; then
        in_container=true
    fi

    if [ "$in_container" = true ]; then
        # 获取cgroup v1信息
        local memory_limit=0
        local memory_usage=0
        local cpu_quota=0
        local cpu_period=0

        # 内存限制 (cgroup v1)
        if [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
            memory_limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "0")
            memory_usage=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null || echo "0")
        fi

        # 内存限制 (cgroup v2)
        if [ -f /sys/fs/cgroup/memory.max ]; then
            memory_limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo "0")
            memory_usage=$(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo "0")
        fi

        # CPU限制 (cgroup v1)
        if [ -f /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then
            cpu_quota=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null || echo "-1")
            cpu_period=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null || echo "100000")
        fi

        # CPU限制 (cgroup v2)
        if [ -f /sys/fs/cgroup/cpu.max ]; then
            local cpu_max=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo "max 100000")
            cpu_quota=$(echo $cpu_max | awk '{print $1}')
            cpu_period=$(echo $cpu_max | awk '{print $2}')
            [ "$cpu_quota" = "max" ] && cpu_quota=-1
        fi

        # 计算CPU限制核心数
        local cpu_limit_cores=0
        if [ "$cpu_quota" -gt 0 ] && [ "$cpu_period" -gt 0 ]; then
            cpu_limit_cores=$(awk "BEGIN {printf \"%.2f\", $cpu_quota / $cpu_period}")
        fi

        # 处理超大内存限制值（通常表示无限制）
        if [ "$memory_limit" -gt 9223372036854775807 ] 2>/dev/null; then
            memory_limit=0
        fi

        container_data="\"container\":{\"detected\":true,\"memory_limit\":$memory_limit,\"memory_usage\":$memory_usage,\"cpu_quota\":$cpu_quota,\"cpu_period\":$cpu_period,\"cpu_limit_cores\":\"$cpu_limit_cores\"}"
    else
        container_data="\"container\":{\"detected\":false}"
    fi

    if [ -n "$container_data" ]; then
        echo ",$container_data"
    fi
}

# 主循环
main() {
    # 降低进程优先级，减少对系统的影响
    nice -n 10 ionice -c 3 -p $$ 2>/dev/null || true
    
    [ $DEBUG -eq 1 ] && echo "# 流式监控开始，间隔: ${INTERVAL}s" >&2
    
    while true; do
        # 使用与网络函数一致的毫秒时间戳
        local timestamp
        if command -v date >/dev/null 2>&1 && date +%s%3N >/dev/null 2>&1; then
            timestamp=$(date +%s%3N)
        else
            timestamp=$(($(date +%s) * 1000))
        fi
        
        # 先更新网络缓存（在主shell中执行）
        update_network_cache

        # 构建JSON输出（单行格式）
        local json_output="{\"timestamp\":$timestamp,"
        json_output="$json_output$(get_cpu_info),"
        json_output="$json_output$(get_memory_info),"
        json_output="$json_output$(get_swap_info),"
        json_output="$json_output$(get_disk_info),"
        json_output="$json_output$(get_network_info_json),"
        json_output="$json_output$(get_static_info)"
        json_output="$json_output$(get_psi_info)"
        json_output="$json_output$(get_container_info)"
        json_output="$json_output}"

        # 输出完整的JSON行
        echo "$json_output"
        
        # 刷新输出缓冲区
        exec 1>&1
        
        sleep $INTERVAL
    done
}

# 信号处理
trap 'exit 0' TERM INT

# 启动主循环
main "$@"
