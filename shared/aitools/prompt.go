package aitools

import (
	"fmt"
	"strings"

	"github.com/easyssh/shared/aipermission"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/protocol"
)

func SystemPrompt(persona, permissionMode string, allowedTools []aiprovider.ToolSpec, scope *protocol.AISessionScope) string {
	scope = aipermission.NormalizeScopePointer(scope)
	var sb strings.Builder
	sb.WriteString(persona)
	sb.WriteString("\n\n")
	sb.WriteString("重要规则：\n")
	sb.WriteString("1. 当用户请求需要执行操作时，你应该直接调用相应工具，不要先用文字询问是否允许。\n")
	sb.WriteString("2. 工具权限与危险操作确认由系统负责，你需要专注于理解需求、正确调用工具、基于结果给出结论。\n")
	sb.WriteString("3. 如果需要多个步骤，请按顺序执行，并始终基于上一步结果推进。\n")
	sb.WriteString("4. 获取工具结果后，必须先引用关键数据给出结论，不要只给模板化建议。\n")
	sb.WriteString("5. 只有当前结果不足以支持结论时，才继续调用下一步工具。\n")
	sb.WriteString("6. 不要重复粘贴大段原始输出，优先提炼关键发现与下一步行动。\n")
	sb.WriteString("7. 当前权限规则：")
	sb.WriteString(aipermission.Rule(permissionMode))
	if scope != nil && scope.Kind == "terminal" {
		sb.WriteString("\n")
		sb.WriteString("8. 当前会话范围：你正在嵌入一个终端页签中，默认面向当前终端连接的服务器。")
		if scope.ServerID != "" {
			sb.WriteString("工具调用必须使用当前服务器 server_id=")
			sb.WriteString(scope.ServerID)
			sb.WriteString("。切换目标需要先更新会话作用域。")
		} else {
			sb.WriteString("如果缺少当前服务器 ID，请先说明无法定位目标服务器。")
		}
	}
	sb.WriteString("\n\n")
	if scope != nil && scope.Kind == "terminal" {
		sb.WriteString("当前终端上下文：\n")
		sb.WriteString(FormatTerminalScope(scope))
		sb.WriteString("\n\n")
	}
	sb.WriteString("本会话可用工具：\n")
	for _, tool := range allowedTools {
		sb.WriteString("- ")
		sb.WriteString(tool.Name)
		sb.WriteString(": ")
		sb.WriteString(tool.Description)
		sb.WriteString("\n")
	}

	return sb.String()
}

func FormatTerminalScope(scope *protocol.AISessionScope) string {
	if scope == nil {
		return "- 未提供当前终端目标信息"
	}
	lines := make([]string, 0, 4)
	if scope.TerminalSessionID != "" {
		lines = append(lines, "- terminal_session_id: "+scope.TerminalSessionID)
	}
	if scope.ServerID != "" {
		lines = append(lines, "- server_id: "+scope.ServerID)
	}
	if scope.ServerName != "" {
		lines = append(lines, "- server_name: "+scope.ServerName)
	}
	if scope.Username != "" || scope.Host != "" || scope.Port > 0 {
		target := scope.Username
		if scope.Host != "" {
			if target != "" {
				target += "@"
			}
			target += scope.Host
		}
		if scope.Port > 0 {
			target += fmt.Sprintf(":%d", scope.Port)
		}
		lines = append(lines, "- connection: "+target)
	}
	if len(lines) == 0 {
		return "- 未提供当前终端目标信息"
	}
	return strings.Join(lines, "\n")
}
