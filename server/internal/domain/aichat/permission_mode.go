package aichat

import (
	"errors"
	"fmt"

	"github.com/easyssh/shared/aipermission"
)

// PermissionMode 会话权限模式
type PermissionMode string

const (
	PermissionModeReadOnly   PermissionMode = aipermission.ModeReadonly
	PermissionModeBalanced   PermissionMode = aipermission.ModeBalanced
	PermissionModePrivileged PermissionMode = aipermission.ModePrivileged
)

var (
	// ErrToolPermissionDenied 工具权限拒绝（可用 errors.Is 判断）
	ErrToolPermissionDenied = errors.New("tool permission denied")
)

type ToolPermissionError struct {
	Mode     PermissionMode
	ToolName string
}

func (e *ToolPermissionError) Error() string {
	return fmt.Sprintf("当前权限模式(%s)不允许执行工具: %s", e.Mode, e.ToolName)
}

func (e *ToolPermissionError) Is(target error) bool {
	return target == ErrToolPermissionDenied
}

// NormalizePermissionMode 规范化权限模式，默认 balanced
func NormalizePermissionMode(raw string) PermissionMode {
	return PermissionMode(aipermission.NormalizeMode(raw))
}

// IsToolAllowedInMode 判断指定权限模式是否允许执行工具
func IsToolAllowedInMode(mode PermissionMode, toolName string) bool {
	normalized := NormalizePermissionMode(string(mode))
	switch normalized {
	case PermissionModeReadOnly:
		// 严格只读：禁止任何可能修改系统状态的工具
		switch toolName {
		case "execute_command", "write_file", "create_directory", "delete_file":
			return false
		default:
			return true
		}
	case PermissionModeBalanced, PermissionModePrivileged:
		return true
	default:
		return true
	}
}
