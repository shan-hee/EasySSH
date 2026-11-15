package aitools

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/easyssh/shared/aipermission"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/protocol"
)

func HasServerIDParameter(parameters map[string]any) bool {
	properties, ok := parameters["properties"].(map[string]interface{})
	if !ok {
		return false
	}
	_, ok = properties["server_id"]
	return ok
}

func PinServerIDParameter(parameters map[string]interface{}, serverID string) map[string]interface{} {
	next := shallowCopyMap(parameters)
	properties, ok := next["properties"].(map[string]interface{})
	if !ok {
		return next
	}

	nextProperties := shallowCopyMap(properties)
	serverIDParam, _ := nextProperties["server_id"].(map[string]interface{})
	nextServerIDParam := shallowCopyMap(serverIDParam)
	nextServerIDParam["const"] = serverID
	nextServerIDParam["default"] = serverID
	nextServerIDParam["description"] = "当前终端会话服务器 ID。必须使用该值；切换目标需要先更新会话作用域。"
	nextProperties["server_id"] = nextServerIDParam
	next["properties"] = nextProperties
	return next
}

func shallowCopyMap(input map[string]interface{}) map[string]interface{} {
	next := make(map[string]interface{}, len(input))
	for key, value := range input {
		next[key] = value
	}
	return next
}

func ScopeToolCall(scope *protocol.AISessionScope, toolCall aiprovider.ToolCall, parameters map[string]any) aiprovider.ToolCall {
	scope = aipermission.NormalizeScopePointer(scope)
	if scope == nil || scope.Kind != "terminal" || scope.ServerID == "" {
		return toolCall
	}

	// Preserve malformed arguments so the executor can reject the original input.
	var args map[string]any
	if err := json.Unmarshal(toolCall.Arguments, &args); err != nil {
		return toolCall
	}
	if _, ok := args["server_id"]; !ok && !HasServerIDParameter(parameters) {
		return toolCall
	}

	if args == nil {
		args = make(map[string]any)
	}
	args["server_id"] = scope.ServerID
	// JSON-decoded values plus a string are always JSON-encodable.
	encoded, _ := json.Marshal(args)
	toolCall.Arguments = encoded
	return toolCall
}

func EnforceScopedArguments(scope *protocol.AISessionScope, parameters map[string]any, args map[string]any) map[string]any {
	normalizedScope := aipermission.NormalizeScopePointer(scope)
	if normalizedScope == nil || normalizedScope.Kind != "terminal" || normalizedScope.ServerID == "" || !HasServerIDParameter(parameters) {
		return args
	}

	next := make(map[string]any, len(args)+1)
	for key, value := range args {
		next[key] = value
	}
	next["server_id"] = normalizedScope.ServerID
	return next
}

// ScopedParameters returns the schema and whether the tool is visible in scope.
// It never mutates a registry's schema.
func ScopedParameters(scope *protocol.AISessionScope, name string, parameters map[string]any) (map[string]any, bool) {
	scope = aipermission.NormalizeScopePointer(scope)
	if scope == nil || scope.ServerID == "" {
		return parameters, true
	}
	if name == "list_servers" {
		return parameters, false
	}
	if HasServerIDParameter(parameters) {
		parameters = PinServerIDParameter(parameters, scope.ServerID)
	}
	return parameters, true
}

// ValidateServerReference checks both the supplied and final scoped target.
// Single references are bound by the host to terminal scope before dispatch.
// Checking the supplied target first preserves rejection of invalid approvals.
func ValidateServerReference(scope *protocol.AISessionScope, parameters map[string]any, refs []protocol.AIServerReference, args map[string]any) string {
	if !HasServerIDParameter(parameters) || len(refs) <= 1 {
		return ""
	}
	for _, candidate := range []map[string]any{args, EnforceScopedArguments(scope, parameters, args)} {
		serverID, ok := candidate["server_id"].(string)
		serverID = strings.TrimSpace(serverID)
		if !ok || serverID == "" {
			return "多服务器引用时，工具必须明确提供正文中引用的 server_id。"
		}
		allowed := false
		for _, ref := range refs {
			if ref.ServerID == serverID {
				allowed = true
				break
			}
		}
		if !allowed {
			return fmt.Sprintf("工具目标 server_id=%s 不在本条消息引用的服务器范围内。请按正文中的 @服务器重新绑定目标。", serverID)
		}
	}
	return ""
}
