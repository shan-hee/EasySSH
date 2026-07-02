package monitoring

// MetricsScriptOptions controls which optional sections are emitted by the
// shared Linux metrics script.
type MetricsScriptOptions struct {
	IncludeStaticInfo  bool
	IncludeDockerStats bool
}

// BuildMetricsScript returns the single source of truth for Linux monitor
// collection. Both the Web server and desktop gateway should use this script.
func BuildMetricsScript(options MetricsScriptOptions) string {
	script := `
LC_ALL=C
export LC_ALL

echo "=== CPU ==="
awk '/^cpu / { print; exit }' /proc/stat

echo "=== MEMORY ==="
awk '/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):/ { print }' /proc/meminfo

echo "=== NETWORK ==="
awk 'NR > 2 { print }' /proc/net/dev

echo "=== DISK ==="
df_output=""
if command -v timeout >/dev/null 2>&1; then
  df_output=$(timeout 1s df -P -B1 -l --total \
    -x tmpfs -x devtmpfs -x squashfs -x overlay -x aufs 2>/dev/null | tail -n 1)
else
  df_output=$(df -P -B1 -l --total \
    -x tmpfs -x devtmpfs -x squashfs -x overlay -x aufs 2>/dev/null | tail -n 1)
fi
if [ -z "$df_output" ] || [ "$(printf '%s\n' "$df_output" | awk '{ print NF }')" -lt 6 ]; then
  if command -v timeout >/dev/null 2>&1; then
    df_output=$(timeout 1s sh -c 'df -kP -l 2>/dev/null || df -kP 2>/dev/null' | awk 'NR > 1 && $2 ~ /^[0-9]+$/ { total += $2; used += $3 } END { if (total > 0) printf "total %.0f %.0f %.0f 0%% -", total * 1024, used * 1024, (total - used) * 1024 }')
  else
    df_output=$( (df -kP -l 2>/dev/null || df -kP 2>/dev/null) | awk 'NR > 1 && $2 ~ /^[0-9]+$/ { total += $2; used += $3 } END { if (total > 0) printf "total %.0f %.0f %.0f 0%% -", total * 1024, used * 1024, (total - used) * 1024 }')
  fi
fi
printf '%s\n' "$df_output"

echo "=== LOAD ==="
cat /proc/loadavg

echo "=== UPTIME ==="
cut -d' ' -f1 /proc/uptime
`

	if options.IncludeStaticInfo {
		script += `
echo "=== SYSINFO ==="
awk -F= '/^PRETTY_NAME=/ { gsub(/^"|"$/, "", $2); print $2; found=1; exit } END { if (!found) print "" }' /etc/os-release 2>/dev/null
hostname 2>/dev/null || cat /proc/sys/kernel/hostname 2>/dev/null
awk -F: '/model name|Hardware|Processor/ { gsub(/^[ \t]+/, "", $2); if ($2 != "") { print $2; exit } }' /proc/cpuinfo 2>/dev/null
uname -m
getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || awk -F: '/^processor/ { n++ } END { print n + 0 }' /proc/cpuinfo 2>/dev/null
`
	}

	if options.IncludeDockerStats {
		script += `
echo "=== DOCKER ==="
` + BuildDockerStatsScript()
	}

	return script
}

func BuildDockerStatsScript() string {
	return `
docker_done=0
if command -v curl >/dev/null 2>&1; then
  docker_json=$(curl -sS --fail --max-time 5 --unix-socket /var/run/docker.sock "http://localhost/containers/json?all=1" 2>/dev/null)
  if [ -n "$docker_json" ]; then
    running=$(printf '%s' "$docker_json" | grep -o '"State"[[:space:]]*:[[:space:]]*"running"' | wc -l | awk '{ print $1 + 0 }')
    total=$(printf '%s' "$docker_json" | grep -o '"Id"[[:space:]]*:' | wc -l | awk '{ print $1 + 0 }')
    echo "installed"
    echo "${running:-0}"
    echo "${total:-0}"
    docker_done=1
  fi
fi
if [ "$docker_done" != "1" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "not_installed"
    echo "0"
    echo "0"
  else
    running_ids=$(docker ps -q 2>/dev/null)
    total_ids=$(docker ps -aq 2>/dev/null)
    running=$(printf '%s\n' "$running_ids" | awk 'NF { n++ } END { print n + 0 }')
    total=$(printf '%s\n' "$total_ids" | awk 'NF { n++ } END { print n + 0 }')
    echo "installed"
    echo "${running:-0}"
    echo "${total:-0}"
  fi
fi
`
}
