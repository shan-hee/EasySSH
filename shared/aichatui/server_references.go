package aichatui

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var ErrServerReferenceUnavailable = errors.New("引用的服务器不存在或不可访问")

// ServerReference keeps identity separate from its display snapshot.
type ServerReference struct {
	ServerID string `json:"server_id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Label    string `json:"label,omitempty"`
	Offset   int    `json:"offset"`
}

// ResolveServerReferences accepts only IDs from the client; all display and
// connection details come from the current user's server repository.
func ResolveServerReferences(refs []ServerReference, resolve func(string) (ServerReference, error)) ([]ServerReference, error) {
	result := make([]ServerReference, 0, len(refs))
	resolved := make(map[string]ServerReference, len(refs))
	for _, ref := range refs {
		id := strings.TrimSpace(ref.ServerID)
		if id == "" {
			return nil, fmt.Errorf("%w: 缺少 ID", ErrServerReferenceUnavailable)
		}
		server, ok := resolved[id]
		if !ok {
			var err error
			server, err = resolve(id)
			if err != nil {
				return nil, fmt.Errorf("%w (%s): %v", ErrServerReferenceUnavailable, id, err)
			}
			resolved[id] = server
		}
		// The resolver owns connection details, while label and offset describe
		// where this ID appeared in the user's sentence and must survive refresh.
		server.Label = ref.Label
		server.Offset = ref.Offset
		result = append(result, server)
	}
	return result, nil
}

func ContentWithServerReferences(content string, refs []ServerReference) string {
	if len(refs) == 0 {
		return content
	}
	data, _ := json.Marshal(refs)
	var mapping strings.Builder
	mapping.WriteString("\n\n用户明确引用的服务器（必须按正文中的出现顺序绑定，不按名称猜测）：\n")
	for index, ref := range refs {
		label := ref.Label
		if label == "" {
			label = ref.Name
		}
		fmt.Fprintf(&mapping, "%d. 正文引用 @%s（offset=%d）对应 server_id=%s。\n", index+1, label, ref.Offset, ref.ServerID)
	}
	mapping.WriteString("服务器连接快照 JSON：\n")
	mapping.WriteString(string(data))
	return content + mapping.String()
}
