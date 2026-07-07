package aipermission

import "strings"

const (
	ModeReadonly   = "readonly"
	ModeBalanced   = "balanced"
	ModePrivileged = "privileged"
)

func NormalizeMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case ModeReadonly:
		return ModeReadonly
	case ModePrivileged:
		return ModePrivileged
	case ModeBalanced:
		fallthrough
	default:
		return ModeBalanced
	}
}

func Rule(mode string) string {
	switch NormalizeMode(mode) {
	case ModeReadonly:
		return "当前是只读分析模式：仅允许查询、读取、分析；如果用户要求写入、删除或状态变更，请明确说明限制并给出只读替代方案。"
	case ModePrivileged:
		return "当前是全部权限模式：可直接使用当前会话可见的全部工具；危险操作无需等待二次确认，但需要在结果中说明风险与影响。"
	default:
		return "当前是标准权限模式：允许常规运维操作；危险动作会进入系统确认流程。"
	}
}
