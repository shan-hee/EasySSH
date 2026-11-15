package aitools

import (
	"strings"
	"testing"

	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/protocol"
)

func TestFormatTerminalScope(t *testing.T) {
	for _, tt := range []struct {
		name  string
		scope *protocol.AISessionScope
		want  string
	}{
		{name: "nil", want: "- 未提供当前终端目标信息"},
		{name: "empty", scope: &protocol.AISessionScope{}, want: "- 未提供当前终端目标信息"},
		{name: "full", scope: &protocol.AISessionScope{TerminalSessionID: "t", ServerID: "s", ServerName: "name", Username: "root", Host: "host", Port: 22}, want: "- terminal_session_id: t\n- server_id: s\n- server_name: name\n- connection: root@host:22"},
		{name: "host only", scope: &protocol.AISessionScope{Host: "host"}, want: "- connection: host"},
		{name: "user only", scope: &protocol.AISessionScope{Username: "root"}, want: "- connection: root"},
		{name: "port only", scope: &protocol.AISessionScope{Port: 22}, want: "- connection: :22"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatTerminalScope(tt.scope); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSystemPrompt(t *testing.T) {
	for _, tt := range []struct {
		name, persona, mode string
		scope               *protocol.AISessionScope
		want, absent        []string
	}{
		{name: "server readonly", persona: "服务器助手", mode: "readonly", want: []string{"只读分析模式"}, absent: []string{"当前终端上下文"}},
		{name: "desktop balanced", persona: "本地助手", mode: " BALANCED ", scope: &protocol.AISessionScope{ServerID: " a "}, want: []string{"标准权限模式", "server_id=a", "当前终端上下文", "切换目标需要先更新会话作用域"}},
		{name: "privileged missing target", persona: "本地助手", mode: "privileged", scope: &protocol.AISessionScope{Kind: "terminal"}, want: []string{"全部权限模式", "如果缺少当前服务器 ID"}},
		{name: "unknown mode", persona: "服务器助手", mode: "unknown", want: []string{"标准权限模式"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := SystemPrompt(tt.persona, tt.mode, []aiprovider.ToolSpec{{Name: "read_file", Description: "读取文件"}}, tt.scope)
			if !strings.HasPrefix(got, tt.persona+"\n\n") {
				t.Fatal("host persona lost")
			}
			for _, part := range append(tt.want, "只有当前结果不足以支持结论时", "工具权限与危险操作确认由系统负责", "- read_file: 读取文件\n") {
				if !strings.Contains(got, part) {
					t.Fatalf("missing %q in %s", part, got)
				}
			}
			for _, part := range append(tt.absent, "除非用户明确要求切换目标") {
				if strings.Contains(got, part) {
					t.Fatalf("unexpected %q", part)
				}
			}
		})
	}
}
