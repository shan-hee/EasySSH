#!/bin/sh
# EasySSH 流式监控采集脚本
# POSIX兼容版：支持ash/dash/bash等shell，直接读取 /proc 和 /sys，输出 NDJSON

# 设置环境变量，避免 locale 问题
export LC_ALL=C
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

# 配置参数
INTERVAL=${1:-1}  # 采集间隔，默认1秒
DEBUG=${2:-0}     # 调试模式

# 错误处理 - POSIX兼容
# 注意：pipefail在POSIX shell中不可用，但脚本中的管道都有适当的错误处理
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
    GET_IFACE_result=$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -1)
    if [ -z "$GET_IFACE_result" ]; then
        # 降级方案：查找第一个非lo接口
        GET_IFACE_result=$(ls /sys/class/net/ | grep -v lo | head -1)
    fi
    echo "${GET_IFACE_result:-eth0}"
}

# 获取主磁盘设备
get_primary_disk() {
    # 获取根分区对应的磁盘设备
    GET_DISK_result=$(df / | tail -1 | awk '{print $1}' | sed 's/[0-9]*$//' | sed 's|/dev/||')
    if [ -z "$GET_DISK_result" ]; then
        # 降级方案
        GET_DISK_result=$(ls /sys/block/ | grep -E '^(sd|nvme|vd)' | head -1)
    fi
    echo "${GET_DISK_result:-sda}"
}

# 获取CPU信息（POSIX兼容版差分算法）
get_cpu_info() {
    if [ -f /proc/stat ]; then
        CPU_line=$(head -1 /proc/stat)

        # 使用set和shift处理CPU统计数据（替代数组）
        set -- $CPU_line
        shift  # 跳过第一个字段 "cpu"

        CPU_user=${1:-0}
        CPU_nice=${2:-0}
        CPU_system=${3:-0}
        CPU_idle=${4:-0}
        CPU_iowait=${5:-0}
        CPU_irq=${6:-0}
        CPU_softirq=${7:-0}
        CPU_steal=${8:-0}
        CPU_guest=${9:-0}
        CPU_guest_nice=${10:-0}

        # 计算总时间和空闲时间（包含guest时间）
        CPU_total=$((CPU_user + CPU_nice + CPU_system + CPU_idle + CPU_iowait + CPU_irq + CPU_softirq + CPU_steal + CPU_guest + CPU_guest_nice))
        CPU_idle_total=$((CPU_idle + CPU_iowait))
        CPU_usage=0

        # 精确的CPU使用率差分算法
        if [ $PREV_CPU_TOTAL -gt 0 ]; then
            CPU_total_diff=$((CPU_total - PREV_CPU_TOTAL))
            CPU_idle_diff=$((CPU_idle_total - PREV_CPU_IDLE))

            if [ $CPU_total_diff -gt 0 ]; then
                # 使用浮点运算提高精度
                CPU_usage=$(awk "BEGIN {printf \"%.1f\", ($CPU_total_diff - $CPU_idle_diff) * 100.0 / $CPU_total_diff}" 2>/dev/null || echo "0")
                # 转换为整数（四舍五入）
                CPU_usage=$(awk "BEGIN {printf \"%.0f\", $CPU_usage}" 2>/dev/null || echo "0")
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: 差分算法 - total_diff=$CPU_total_diff, idle_diff=$CPU_idle_diff, usage=$CPU_usage%" >&2
            fi
        else
            # 第一次运行时，尝试多种方法获取即时CPU使用率
            CPU_usage=0

            # 方法1: 尝试vmstat
            if command -v vmstat >/dev/null 2>&1; then
                CPU_vmstat_output=$(vmstat 1 2 2>/dev/null | tail -1)
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: vmstat输出: $CPU_vmstat_output" >&2
                CPU_vmstat_usage=$(echo "$CPU_vmstat_output" | awk '{print 100 - $15}' 2>/dev/null || echo "")
                if [ -n "$CPU_vmstat_usage" ] && [ "$CPU_vmstat_usage" != "0" ]; then
                    CPU_usage=$(awk "BEGIN {printf \"%.0f\", $CPU_vmstat_usage}" 2>/dev/null || echo "0")
                    [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: vmstat方法成功 - usage=$CPU_usage%" >&2
                else
                    [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: vmstat方法失败 - 输出为空或0" >&2
                fi
            else
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: vmstat命令不可用" >&2
            fi

            # 方法2: 如果vmstat失败，尝试top命令
            if [ "$CPU_usage" = "0" ] && command -v top >/dev/null 2>&1; then
                CPU_top_output=$(top -bn1 2>/dev/null | grep -i "cpu" | head -1)
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: top输出: $CPU_top_output" >&2

                # 尝试多种top输出格式
                CPU_top_idle=""
                # 格式1: %Cpu(s): 1.0 us, 1.0 sy, 0.0 ni, 97.0 id
                if [ -z "$CPU_top_idle" ]; then
                    CPU_top_idle=$(echo "$CPU_top_output" | awk '{for(i=1;i<=NF;i++) if($i ~ /id/) print $(i-1)}' | sed 's/%//g' 2>/dev/null || echo "")
                fi
                # 格式2: CPU: 3% usr 0% sys 0% nic 97% idle
                if [ -z "$CPU_top_idle" ]; then
                    CPU_top_idle=$(echo "$CPU_top_output" | awk '{for(i=1;i<=NF;i++) if($i ~ /idle/) print $(i-1)}' | sed 's/%//g' 2>/dev/null || echo "")
                fi

                if [ -n "$CPU_top_idle" ] && [ "$CPU_top_idle" != "0" ]; then
                    CPU_usage=$(awk "BEGIN {printf \"%.0f\", 100 - $CPU_top_idle}" 2>/dev/null || echo "0")
                    [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: top方法成功 - idle=$CPU_top_idle%, usage=$CPU_usage%" >&2
                else
                    [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: top方法失败 - 无法解析idle值" >&2
                fi
            else
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: top命令不可用或CPU已有值" >&2
            fi

            # 方法3: 如果都失败，尝试直接计算/proc/stat的即时使用率
            if [ "$CPU_usage" = "0" ] && [ -f /proc/stat ]; then
                # 读取两次/proc/stat，间隔短时间计算差值
                CPU_stat1=$(head -1 /proc/stat)
                sleep 0.1  # 短暂等待
                CPU_stat2=$(head -1 /proc/stat)

                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: stat1=$CPU_stat1" >&2
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: stat2=$CPU_stat2" >&2

                # 解析第一次数据
                set -- $CPU_stat1
                shift
                CPU_total1=$((${1:-0} + ${2:-0} + ${3:-0} + ${4:-0} + ${5:-0} + ${6:-0} + ${7:-0}))
                CPU_idle1=${4:-0}

                # 解析第二次数据
                set -- $CPU_stat2
                shift
                CPU_total2=$((${1:-0} + ${2:-0} + ${3:-0} + ${4:-0} + ${5:-0} + ${6:-0} + ${7:-0}))
                CPU_idle2=${4:-0}

                # 计算差值
                CPU_total_diff_instant=$((CPU_total2 - CPU_total1))
                CPU_idle_diff_instant=$((CPU_idle2 - CPU_idle1))

                if [ $CPU_total_diff_instant -gt 0 ]; then
                    CPU_usage=$(awk "BEGIN {printf \"%.0f\", ($CPU_total_diff_instant - $CPU_idle_diff_instant) * 100.0 / $CPU_total_diff_instant}" 2>/dev/null || echo "0")
                    [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: /proc/stat即时计算成功 - total_diff=$CPU_total_diff_instant, idle_diff=$CPU_idle_diff_instant, usage=$CPU_usage%" >&2
                else
                    [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: /proc/stat即时计算失败 - 差值为0" >&2
                fi
            fi

            # 方法4: 如果都失败，基于负载平均值估算
            if [ "$CPU_usage" = "0" ] && [ -f /proc/loadavg ]; then
                CPU_load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "0")
                CPU_cores_for_calc=${CPU_cores:-1}
                # 简单估算：负载/核心数 * 100，但限制在100以内
                CPU_usage=$(awk "BEGIN {usage = $CPU_load1 / $CPU_cores_for_calc * 100; if(usage > 100) usage = 100; printf \"%.0f\", usage}" 2>/dev/null || echo "0")
                [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: 负载估算方法 - load1=$CPU_load1, cores=$CPU_cores_for_calc, usage=$CPU_usage%" >&2
            fi

            [ $DEBUG -eq 1 ] && echo "# CPU DEBUG: 第一次运行，最终usage=$CPU_usage%" >&2
        fi

        # 确保CPU_usage有有效值
        CPU_usage=${CPU_usage:-0}

        PREV_CPU_TOTAL=$CPU_total
        PREV_CPU_IDLE=$CPU_idle_total

        # 获取CPU核心数和型号（缓存）
        CPU_cores=$(nproc 2>/dev/null || echo "1")
        CPU_model=""
        if [ -z "$CPU_MODEL_CACHED" ]; then
            CPU_model=$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null | sed 's/^[ \t]*//')
            CPU_MODEL_CACHED="${CPU_model:-Unknown}"
        fi

        # 获取负载平均值
        CPU_load_avg=""
        if [ -f /proc/loadavg ]; then
            CPU_load_avg=$(awk '{printf "\"load1\":%.2f,\"load5\":%.2f,\"load15\":%.2f", $1, $2, $3}' /proc/loadavg 2>/dev/null || echo "\"load1\":0,\"load5\":0,\"load15\":0")
        else
            CPU_load_avg="\"load1\":0,\"load5\":0,\"load15\":0"
        fi

        # 确保所有变量有有效值
        CPU_usage=${CPU_usage:-0}
        CPU_cores=${CPU_cores:-1}
        CPU_MODEL_CACHED=${CPU_MODEL_CACHED:-"Unknown"}
        CPU_load_avg=${CPU_load_avg:-"\"load1\":0,\"load5\":0,\"load15\":0"}

        echo "\"cpu\":{\"usage\":$CPU_usage,\"cores\":$CPU_cores,\"model\":\"$CPU_MODEL_CACHED\",\"loadAverage\":{$CPU_load_avg}}"
    else
        echo "\"cpu\":{\"usage\":0,\"cores\":1,\"model\":\"Unknown\",\"loadAverage\":{\"load1\":0,\"load5\":0,\"load15\":0}}"
    fi
}

# 获取内存信息
get_memory_info() {
    if [ -f /proc/meminfo ]; then
        MEM_total=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
        MEM_available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
        MEM_free=$(awk '/MemFree:/ {print $2}' /proc/meminfo)
        MEM_buffers=$(awk '/Buffers:/ {print $2}' /proc/meminfo)
        MEM_cached=$(awk '/^Cached:/ {print $2}' /proc/meminfo)

        # 确保变量有默认值
        MEM_total=${MEM_total:-0}
        MEM_available=${MEM_available:-0}
        MEM_free=${MEM_free:-0}
        MEM_buffers=${MEM_buffers:-0}
        MEM_cached=${MEM_cached:-0}

        # 转换为字节
        MEM_total=$((MEM_total * 1024))

        # 优先使用 MemAvailable，降级使用计算值
        if [ -n "$MEM_available" ] && [ "$MEM_available" -gt 0 ]; then
            MEM_used=$((MEM_total - MEM_available * 1024))
        else
            MEM_used=$((MEM_total - (MEM_free + MEM_buffers + MEM_cached) * 1024))
        fi

        MEM_usage_pct=0
        if [ $MEM_total -gt 0 ]; then
            MEM_usage_pct=$((MEM_used * 100 / MEM_total))
        fi

        # 确保最终值有效
        MEM_total=${MEM_total:-0}
        MEM_used=${MEM_used:-0}
        MEM_usage_pct=${MEM_usage_pct:-0}

        echo "\"memory\":{\"total\":$MEM_total,\"used\":$MEM_used,\"usedPercentage\":$MEM_usage_pct}"
    else
        echo "\"memory\":{\"total\":0,\"used\":0,\"usedPercentage\":0}"
    fi
}

# 获取交换分区信息
get_swap_info() {
    if [ -f /proc/meminfo ]; then
        SWAP_total=$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)
        SWAP_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)

        # 确保变量有默认值
        SWAP_total=${SWAP_total:-0}
        SWAP_free=${SWAP_free:-0}

        SWAP_total=$((SWAP_total * 1024))
        SWAP_free=$((SWAP_free * 1024))
        SWAP_used=$((SWAP_total - SWAP_free))

        SWAP_usage_pct=0
        if [ $SWAP_total -gt 0 ]; then
            SWAP_usage_pct=$((SWAP_used * 100 / SWAP_total))
        fi

        # 确保最终值有效
        SWAP_total=${SWAP_total:-0}
        SWAP_used=${SWAP_used:-0}
        SWAP_usage_pct=${SWAP_usage_pct:-0}

        echo "\"swap\":{\"total\":$SWAP_total,\"used\":$SWAP_used,\"usedPercentage\":$SWAP_usage_pct}"
    else
        echo "\"swap\":{\"total\":0,\"used\":0,\"usedPercentage\":0}"
    fi
}

# 获取磁盘信息
get_disk_info() {
    # 尝试多种方法获取磁盘信息
    DISK_total=0
    DISK_used=0
    DISK_available=0
    DISK_usage_pct=0

    # 方法1: 使用 df -B1 获取根分区信息
    DISK_info=$(df -B1 / 2>/dev/null | tail -1)
    [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: df -B1 输出: $DISK_info" >&2

    if [ -n "$DISK_info" ]; then
        # 使用set和shift处理磁盘信息（替代数组）
        set -- $DISK_info
        DISK_device=$1
        DISK_total=${2:-0}
        DISK_used=${3:-0}
        DISK_available=${4:-0}
        [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: 解析结果 - device=$DISK_device, total=$DISK_total, used=$DISK_used, available=$DISK_available" >&2
    else
        [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: df -B1 失败，尝试其他方法" >&2

        # 方法2: 尝试不同的df参数
        DISK_info=$(df / 2>/dev/null | tail -1)
        [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: df 输出: $DISK_info" >&2

        if [ -n "$DISK_info" ]; then
            set -- $DISK_info
            DISK_device=$1
            # df默认输出可能是KB，需要转换为字节
            DISK_total_kb=${2:-0}
            DISK_used_kb=${3:-0}
            DISK_available_kb=${4:-0}

            DISK_total=$((DISK_total_kb * 1024))
            DISK_used=$((DISK_used_kb * 1024))
            DISK_available=$((DISK_available_kb * 1024))
            [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: KB转换结果 - total=$DISK_total, used=$DISK_used, available=$DISK_available" >&2
        else
            [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: 所有df方法都失败" >&2
        fi
    fi

    # 计算使用率
    if [ $DISK_total -gt 0 ]; then
        DISK_usage_pct=$((DISK_used * 100 / DISK_total))
    fi

    # 确保最终值有效
    DISK_total=${DISK_total:-0}
    DISK_used=${DISK_used:-0}
    DISK_available=${DISK_available:-0}
    DISK_usage_pct=${DISK_usage_pct:-0}

    [ $DEBUG -eq 1 ] && echo "# DISK DEBUG: 最终结果 - total=$DISK_total, used=$DISK_used, available=$DISK_available, usage=$DISK_usage_pct%" >&2
    echo "\"disk\":{\"total\":$DISK_total,\"used\":$DISK_used,\"free\":$DISK_available,\"usedPercentage\":$DISK_usage_pct}"
}

# 更新网络缓存（在主shell中执行）
update_network_cache() {
    NET_iface=$(get_primary_interface)
    NET_rx_bytes=0
    NET_tx_bytes=0

    # 读取网络统计信息
    if [ -f "/sys/class/net/$NET_iface/statistics/rx_bytes" ]; then
        NET_rx_bytes=$(cat "/sys/class/net/$NET_iface/statistics/rx_bytes" 2>/dev/null || echo "0")
        NET_tx_bytes=$(cat "/sys/class/net/$NET_iface/statistics/tx_bytes" 2>/dev/null || echo "0")
    fi

    # 使用高精度时间戳（毫秒）- 兼容性改进
    NET_current_time_ms=""
    if command -v date >/dev/null 2>&1 && date +%s%3N >/dev/null 2>&1; then
        NET_current_time_ms=$(date +%s%3N)
    else
        # 降级到秒级精度
        NET_current_time_ms=$(($(date +%s) * 1000))
    fi

    # 精确的网络速率计算
    [ $DEBUG -eq 1 ] && echo "# NET DEBUG: Checking PREV_TIMESTAMP=$PREV_TIMESTAMP" >&2
    if [ $PREV_TIMESTAMP -gt 0 ]; then
        NET_time_diff_ms=$((NET_current_time_ms - PREV_TIMESTAMP))
        NET_rx_diff=$((NET_rx_bytes - PREV_NET_RX))
        NET_tx_diff=$((NET_tx_bytes - PREV_NET_TX))

        if [ $NET_time_diff_ms -gt 0 ]; then
            # 计算字节/秒，使用毫秒精度
            CURRENT_RX_SPEED=$(( NET_rx_diff * 1000 / NET_time_diff_ms ))
            CURRENT_TX_SPEED=$(( NET_tx_diff * 1000 / NET_time_diff_ms ))

            # 防止负值（可能由于计数器重置）
            [ $CURRENT_RX_SPEED -lt 0 ] && CURRENT_RX_SPEED=0
            [ $CURRENT_TX_SPEED -lt 0 ] && CURRENT_TX_SPEED=0

            # 调试信息（强制输出到stdout用于调试）
            if [ $DEBUG -eq 1 ]; then
                echo "# NET DEBUG: time_diff=${NET_time_diff_ms}ms, rx_diff=${NET_rx_diff}, tx_diff=${NET_tx_diff}, rx_speed=${CURRENT_RX_SPEED}B/s, tx_speed=${CURRENT_TX_SPEED}B/s" >&2
                echo "# NET DEBUG: PREV_NET_RX=${PREV_NET_RX}, rx_bytes=${NET_rx_bytes}, PREV_TIMESTAMP=${PREV_TIMESTAMP}, current_time_ms=${NET_current_time_ms}" >&2
            fi
        fi
    else
        # 第一次运行时，初始化历史数据但速度设为0（这是正常的）
        CURRENT_RX_SPEED=0
        CURRENT_TX_SPEED=0
        [ $DEBUG -eq 1 ] && echo "# NET DEBUG: First run, initializing with 0 speed" >&2
    fi

    # 更新缓存
    PREV_NET_RX=$NET_rx_bytes
    PREV_NET_TX=$NET_tx_bytes
    PREV_TIMESTAMP=$NET_current_time_ms

    # 调试：显示更新后的缓存值
    [ $DEBUG -eq 1 ] && echo "# NET DEBUG: Updated cache - PREV_NET_RX=$PREV_NET_RX, PREV_NET_TX=$PREV_NET_TX, PREV_TIMESTAMP=$PREV_TIMESTAMP" >&2
}

# 获取网络信息JSON（使用缓存的速度值）
get_network_info_json() {
    NET_JSON_iface=$(get_primary_interface)
    NET_JSON_rx_packets=0
    NET_JSON_tx_packets=0

    # 读取数据包统计
    if [ -f "/sys/class/net/$NET_JSON_iface/statistics/rx_packets" ]; then
        NET_JSON_rx_packets=$(cat "/sys/class/net/$NET_JSON_iface/statistics/rx_packets" 2>/dev/null || echo "0")
        NET_JSON_tx_packets=$(cat "/sys/class/net/$NET_JSON_iface/statistics/tx_packets" 2>/dev/null || echo "0")
    fi

    # 获取网络接口状态
    NET_JSON_link_speed=0
    NET_JSON_link_state="unknown"
    if [ -f "/sys/class/net/$NET_JSON_iface/speed" ]; then
        NET_JSON_link_speed=$(cat "/sys/class/net/$NET_JSON_iface/speed" 2>/dev/null || echo "0")
        # 转换为bps
        NET_JSON_link_speed=$((NET_JSON_link_speed * 1000000))
    fi

    if [ -f "/sys/class/net/$NET_JSON_iface/operstate" ]; then
        NET_JSON_link_state=$(cat "/sys/class/net/$NET_JSON_iface/operstate" 2>/dev/null || echo "unknown")
    fi

    echo "\"network\":{\"interface\":\"$NET_JSON_iface\",\"total_rx_speed\":${CURRENT_RX_SPEED:-0},\"total_tx_speed\":${CURRENT_TX_SPEED:-0},\"rx_packets\":$NET_JSON_rx_packets,\"tx_packets\":$NET_JSON_tx_packets,\"link_speed\":$NET_JSON_link_speed,\"link_state\":\"$NET_JSON_link_state\"}"
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
    STATIC_current_time=$(date +%s)

    # 检查缓存是否有效（5分钟 = 300秒）
    if [ $STATIC_INFO_CACHED -gt 0 ] && [ $((STATIC_current_time - STATIC_INFO_CACHED)) -lt 300 ]; then
        echo "$STATIC_INFO"
        return
    fi

    # 获取主机名
    STATIC_hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown")

    # 获取操作系统信息
    STATIC_os_name="Linux"
    STATIC_os_version="unknown"
    if [ -f /etc/os-release ]; then
        STATIC_os_name=$(grep '^PRETTY_NAME=' /etc/os-release | cut -d'"' -f2 | head -1)
        STATIC_os_version=$(grep '^VERSION=' /etc/os-release | cut -d'"' -f2 | head -1)
    fi

    # 获取架构
    STATIC_arch=$(uname -m 2>/dev/null || echo "unknown")

    # 获取运行时间
    STATIC_uptime=0
    if [ -f /proc/uptime ]; then
        STATIC_uptime=$(awk '{print int($1)}' /proc/uptime)
    fi

    # 获取内网IP
    STATIC_internal_ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -1)
    if [ -z "$STATIC_internal_ip" ]; then
        STATIC_internal_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi

    STATIC_INFO="\"os\":{\"hostname\":\"$STATIC_hostname\",\"platform\":\"Linux\",\"release\":\"$STATIC_os_name\",\"arch\":\"$STATIC_arch\",\"uptime\":$STATIC_uptime},\"ip\":{\"internal\":\"${STATIC_internal_ip:-unknown}\"}"
    STATIC_INFO_CACHED=$STATIC_current_time

    echo "$STATIC_INFO"
}

# 获取PSI压力信息（如果支持）
get_psi_info() {
    PSI_data=""

    if [ -f /proc/pressure/cpu ]; then
        PSI_cpu_pressure=$(awk '/avg10=/ {gsub(/avg10=/, ""); gsub(/%/, ""); print $2}' /proc/pressure/cpu 2>/dev/null | head -1)
        PSI_cpu_pressure=${PSI_cpu_pressure:-0}
        PSI_data="\"cpu\":$PSI_cpu_pressure"
    fi

    if [ -f /proc/pressure/memory ]; then
        PSI_mem_pressure=$(awk '/avg10=/ {gsub(/avg10=/, ""); gsub(/%/, ""); print $2}' /proc/pressure/memory 2>/dev/null | head -1)
        PSI_mem_pressure=${PSI_mem_pressure:-0}
        if [ -n "$PSI_data" ]; then
            PSI_data="$PSI_data,\"memory\":$PSI_mem_pressure"
        else
            PSI_data="\"memory\":$PSI_mem_pressure"
        fi
    fi

    if [ -f /proc/pressure/io ]; then
        PSI_io_pressure=$(awk '/avg10=/ {gsub(/avg10=/, ""); gsub(/%/, ""); print $2}' /proc/pressure/io 2>/dev/null | head -1)
        PSI_io_pressure=${PSI_io_pressure:-0}
        if [ -n "$PSI_data" ]; then
            PSI_data="$PSI_data,\"io\":$PSI_io_pressure"
        else
            PSI_data="\"io\":$PSI_io_pressure"
        fi
    fi

    if [ -n "$PSI_data" ]; then
        echo ",\"psi\":{$PSI_data}"
    fi
}

# 获取容器信息（如果在容器中运行）
get_container_info() {
    CONTAINER_data=""

    # 检查是否在容器中
    CONTAINER_in_container=false
    if [ -f /.dockerenv ] || [ -f /proc/1/cgroup ] && grep -q docker /proc/1/cgroup 2>/dev/null; then
        CONTAINER_in_container=true
    fi

    if [ "$CONTAINER_in_container" = true ]; then
        # 获取cgroup v1信息
        CONTAINER_memory_limit=0
        CONTAINER_memory_usage=0
        CONTAINER_cpu_quota=0
        CONTAINER_cpu_period=0

        # 内存限制 (cgroup v1)
        if [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
            CONTAINER_memory_limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "0")
            CONTAINER_memory_usage=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null || echo "0")
        fi

        # 内存限制 (cgroup v2)
        if [ -f /sys/fs/cgroup/memory.max ]; then
            CONTAINER_memory_limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo "0")
            CONTAINER_memory_usage=$(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo "0")
        fi

        # CPU限制 (cgroup v1)
        if [ -f /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then
            CONTAINER_cpu_quota=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null || echo "-1")
            CONTAINER_cpu_period=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null || echo "100000")
        fi

        # CPU限制 (cgroup v2)
        if [ -f /sys/fs/cgroup/cpu.max ]; then
            CONTAINER_cpu_max=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo "max 100000")
            CONTAINER_cpu_quota=$(echo $CONTAINER_cpu_max | awk '{print $1}')
            CONTAINER_cpu_period=$(echo $CONTAINER_cpu_max | awk '{print $2}')
            [ "$CONTAINER_cpu_quota" = "max" ] && CONTAINER_cpu_quota=-1
        fi

        # 计算CPU限制核心数
        CONTAINER_cpu_limit_cores=0
        if [ "$CONTAINER_cpu_quota" -gt 0 ] && [ "$CONTAINER_cpu_period" -gt 0 ]; then
            CONTAINER_cpu_limit_cores=$(awk "BEGIN {printf \"%.2f\", $CONTAINER_cpu_quota / $CONTAINER_cpu_period}")
        fi

        # 处理超大内存限制值（通常表示无限制）
        if [ "$CONTAINER_memory_limit" -gt 9223372036854775807 ] 2>/dev/null; then
            CONTAINER_memory_limit=0
        fi

        CONTAINER_data="\"container\":{\"detected\":true,\"memory_limit\":$CONTAINER_memory_limit,\"memory_usage\":$CONTAINER_memory_usage,\"cpu_quota\":$CONTAINER_cpu_quota,\"cpu_period\":$CONTAINER_cpu_period,\"cpu_limit_cores\":\"$CONTAINER_cpu_limit_cores\"}"
    else
        CONTAINER_data="\"container\":{\"detected\":false}"
    fi

    if [ -n "$CONTAINER_data" ]; then
        echo ",$CONTAINER_data"
    fi
}

# 主循环
main() {
    # 降低进程优先级，减少对系统的影响
    nice -n 10 ionice -c 3 -p $$ 2>/dev/null || true
    
    [ $DEBUG -eq 1 ] && echo "# 流式监控开始，间隔: ${INTERVAL}s" >&2
    
    while true; do
        # 使用与网络函数一致的毫秒时间戳
        MAIN_timestamp=""
        if command -v date >/dev/null 2>&1 && date +%s%3N >/dev/null 2>&1; then
            MAIN_timestamp=$(date +%s%3N)
        else
            MAIN_timestamp=$(($(date +%s) * 1000))
        fi

        # 先更新网络缓存（在主shell中执行）
        update_network_cache

        # 构建JSON输出（单行格式）
        MAIN_json_output="{\"timestamp\":$MAIN_timestamp,"
        MAIN_json_output="$MAIN_json_output$(get_cpu_info),"
        MAIN_json_output="$MAIN_json_output$(get_memory_info),"
        MAIN_json_output="$MAIN_json_output$(get_swap_info),"
        MAIN_json_output="$MAIN_json_output$(get_disk_info),"
        MAIN_json_output="$MAIN_json_output$(get_network_info_json),"
        MAIN_json_output="$MAIN_json_output$(get_static_info)"
        MAIN_json_output="$MAIN_json_output$(get_psi_info)"
        MAIN_json_output="$MAIN_json_output$(get_container_info)"
        MAIN_json_output="$MAIN_json_output}"

        # 输出完整的JSON行
        echo "$MAIN_json_output"
        
        # 刷新输出缓冲区
        exec 1>&1
        
        sleep $INTERVAL
    done
}

# 信号处理
trap 'exit 0' TERM INT

# 启动主循环
main "$@"
