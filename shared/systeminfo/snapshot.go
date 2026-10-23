// Package systeminfo collects read-only Linux system tables over SSH.
package systeminfo

import (
	"fmt"
	"regexp"
	"strings"
)

type Snapshot struct {
	Rows      []map[string]string `json:"rows"`
	Truncated bool                `json:"truncated"`
}

// Match complete ss process tuples, not numbers embedded in process names.
var socketProcessPattern = regexp.MustCompile(`\("(?:\\.|[^"\\])*",pid=([1-9][0-9]*),fd=[0-9]+\)`)

func socketProcessIDs(process string) string {
	ids := make([]string, 0)
	seen := make(map[string]bool)
	for _, match := range socketProcessPattern.FindAllStringSubmatch(process, -1) {
		pid := match[1]
		if !seen[pid] {
			seen[pid] = true
			ids = append(ids, pid)
		}
	}
	return strings.Join(ids, ", ")
}

// Command only accepts known table names; no user-provided shell is interpolated.
func Command(kind string) (string, error) {
	switch kind {
	case "processes":
		return "LC_ALL=C ps -eo pid=,user=,pcpu=,pmem=,stat=,args= --sort=-pcpu", nil
	case "ports":
		return "LC_ALL=C ss -H -lntup", nil
	case "services":
		return "LC_ALL=C SYSTEMD_COLORS=0 systemctl list-units --type=service --all --plain --no-legend --no-pager", nil
	default:
		return "", fmt.Errorf("unknown system table: %s", kind)
	}
}

func Parse(kind, output string) Snapshot {
	result := Snapshot{Rows: make([]map[string]string, 0)}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		var row map[string]string
		switch kind {
		case "processes":
			if len(fields) < 6 {
				continue
			}
			row = map[string]string{"pid": fields[0], "user": fields[1], "cpu": fields[2], "memory": fields[3], "state": fields[4], "command": strings.Join(fields[5:], " ")}
		case "ports":
			if len(fields) < 6 {
				continue
			}
			process := strings.Join(fields[6:], " ")
			row = map[string]string{"protocol": fields[0], "state": fields[1], "local": fields[4], "peer": fields[5], "process": process, "pid": socketProcessIDs(process)}
		case "services":
			if len(fields) < 4 {
				continue
			}
			row = map[string]string{"name": fields[0], "load": fields[1], "active": fields[2], "state": fields[3], "description": strings.Join(fields[4:], " ")}
		}
		if row == nil {
			continue
		}
		if len(result.Rows) == 2000 {
			result.Truncated = true
			break
		}
		result.Rows = append(result.Rows, row)
	}
	return result
}
