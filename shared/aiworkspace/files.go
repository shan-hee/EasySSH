package aiworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"
)

const CreateTool = "create_artifact"
const MaxFileBytes = 2 * 1024 * 1024
const CreateDescription = "生成可预览、下载的会话文件，例如报告、脚本、配置或 HTML。仅保存在当前会话，不写入服务器。用户要求生成文件时使用此工具；修改服务器文件使用 write_file 以记录真实修改对比。"

func CreateParameters() map[string]interface{} {
	return map[string]interface{}{"type": "object", "properties": map[string]interface{}{
		"name":     map[string]interface{}{"type": "string", "description": "包含扩展名的文件名"},
		"content":  map[string]interface{}{"type": "string", "description": "完整文件内容；图片使用 base64"},
		"encoding": map[string]interface{}{"type": "string", "enum": []string{"utf8", "base64"}, "description": "默认 utf8，base64 仅用于 PNG/JPEG/WebP/GIF 图片"},
	}, "required": []string{"name", "content"}}
}

type FileSummary struct {
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      int    `json:"size"`
	Path      string `json:"path,omitempty"`
	ServerID  string `json:"server_id,omitempty"`
	Kind      string `json:"kind"`
}

// File bodies are persisted with their originating task, never in public task
// snapshots. The authenticated file endpoint loads them only when requested.
type FileArtifact struct {
	FileSummary
	Content      string  `json:"content"`
	Encoding     string  `json:"encoding"`
	Before       *string `json:"before,omitempty"`
	Existed      bool    `json:"existed"`
	BaselineHash string  `json:"baseline_hash,omitempty"`
}

func NewFile(name, content, encoding string) (*FileArtifact, error) {
	name = path.Base(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	if name == "" || name == "." || name == ".." || name == "/" {
		return nil, errors.New("file name is required")
	}
	if len(content) > MaxFileBytes*2 {
		return nil, errors.New("file exceeds the 2 MiB preview limit")
	}
	mediaType := mime.TypeByExtension(strings.ToLower(path.Ext(name)))
	size := len(content)
	if encoding == "base64" {
		data, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return nil, errors.New("invalid image base64")
		}
		size = len(data)
		mediaType = http.DetectContentType(data)
		switch mediaType {
		case "image/png", "image/jpeg", "image/webp", "image/gif":
		default:
			return nil, errors.New("unsupported image format")
		}
	} else {
		if encoding != "" && encoding != "utf8" {
			return nil, errors.New("unsupported encoding")
		}
		if !utf8.ValidString(content) || strings.ContainsRune(content, 0) {
			return nil, errors.New("only UTF-8 text is supported")
		}
		encoding = "utf8"
		if mediaType == "" {
			mediaType = "text/plain"
		}
	}
	if size > MaxFileBytes {
		return nil, errors.New("file exceeds the 2 MiB preview limit")
	}
	return &FileArtifact{FileSummary: FileSummary{Name: name, MediaType: mediaType, Size: size, Kind: "generated"}, Content: content, Encoding: encoding}, nil
}

func Create(raw json.RawMessage) (*FileArtifact, error) {
	var input struct {
		Name     string  `json:"name"`
		Content  *string `json:"content"`
		Encoding string  `json:"encoding"`
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	if input.Content == nil {
		return nil, errors.New("file content is required")
	}
	return NewFile(input.Name, *input.Content, input.Encoding)
}

// PublicArguments keeps file bodies out of repeated UI snapshots. The original
// arguments remain on the stored task for execution and provider history.
func PublicArguments(tool string, args map[string]interface{}) map[string]interface{} {
	if tool != CreateTool && tool != "write_file" {
		return args
	}
	public := make(map[string]interface{}, len(args))
	for key, value := range args {
		if key != "content" {
			public[key] = value
		}
	}
	return public
}

func Hash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func PrepareWrite(serverID, filePath, before, after string, existed bool) (*FileArtifact, error) {
	if len(before) > MaxFileBytes || !utf8.ValidString(before) || strings.ContainsRune(before, 0) {
		return nil, errors.New("original file is not supported for text comparison")
	}
	file, err := NewFile(filePath, after, "utf8")
	if err != nil {
		return nil, err
	}
	file.Kind = "modified"
	file.ServerID, file.Path, file.Before, file.Existed = serverID, filePath, &before, existed
	file.BaselineHash = Hash(before)
	return file, nil
}

func (f *FileArtifact) CheckBaseline(content string, exists bool) error {
	if f == nil || f.Before == nil {
		return errors.New("file change was not prepared")
	}
	if f.Existed != exists || f.BaselineHash != Hash(content) {
		return fmt.Errorf("文件在预览后已变化，本次修改未写入；请重新读取文件并生成修改方案")
	}
	return nil
}

type fileContextKey struct{}

func WithFile(ctx context.Context, file *FileArtifact) context.Context {
	return context.WithValue(ctx, fileContextKey{}, file)
}
func PreparedFile(ctx context.Context) *FileArtifact {
	f, _ := ctx.Value(fileContextKey{}).(*FileArtifact)
	return f
}
