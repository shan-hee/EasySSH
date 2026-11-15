package aitools

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/sftputil"
)

// DirectoryEntry contains the metadata exposed to the model by either host.
// Fields keep the alphabetical order of the original JSON map rendering.
type DirectoryEntry struct {
	IsDir      bool   `json:"is_dir"`
	IsLink     bool   `json:"is_link"`
	LinkTarget string `json:"link_target"`
	ModifiedAt string `json:"modified_at"`
	Name       string `json:"name"`
	Path       string `json:"path"`
	Permission string `json:"permission"`
	Size       int64  `json:"size"`
}

// DirectoryResult sorts a private copy and returns whole entries within the
// output budget. A single oversized entry is returned to ensure forward progress.
func DirectoryResult(directory string, canRead bool, entries []DirectoryEntry, offset, limit int) string {
	entries = slices.Clone(entries)
	slices.SortFunc(entries, func(a, b DirectoryEntry) int { return strings.Compare(a.Name, b.Name) })
	if limit <= 0 {
		limit = 100
	}
	start := min(max(offset, 0), len(entries))
	end, size := start, 0
	files := make([]DirectoryEntry, 0, min(limit, len(entries)-start))
	for ; end < len(entries) && end-start < limit; end++ {
		// Measure the same indentation used in the final JSON (including comma/newline).
		rendered, _ := json.MarshalIndent(entries[end], "    ", "  ")
		size += len(rendered) + 6
		if size > aitooloutput.StoredTextBytes && end > start {
			break
		}
		files = append(files, entries[end])
	}
	page := map[string]interface{}{
		"path": directory, "parent": sftputil.ParentPath(directory),
		"files": files, "offset": start, "total": len(entries), "can_read": canRead,
	}
	if end < len(entries) {
		page["next_offset"] = end
	}
	// All values above are JSON primitives or DirectoryEntry fields.
	rendered, _ := json.MarshalIndent(page, "", "  ")
	return "目录列表:\n" + string(rendered)
}

// ReadFileResult hashes the raw snapshot but sanitizes the model-facing excerpt.
// It never splits or skips a line; an oversized first line is an explicit error.
func ReadFileResult(filePath, content string, startLine, maxLines int) (string, error) {
	if len(content) > aiworkspace.MaxFileBytes {
		return "", fmt.Errorf("读取文件失败: file exceeds the 2 MiB preview limit")
	}
	startLine = max(startLine, 1)
	if maxLines <= 0 {
		maxLines = 100
	}
	// The hash covers the raw file, so it matches write_file's expected_sha256 check.
	hash := aiworkspace.Hash(content)
	lines := strings.Split(strings.TrimSuffix(aitooloutput.Sanitize(content), "\n"), "\n")
	if startLine > len(lines) {
		return "", fmt.Errorf("文件 %s 共 %d 行，start_line=%d 超出范围 (sha256=%s)", filePath, len(lines), startLine, hash)
	}
	// Stop at whole lines within the output budget so the reported range is exact.
	end := startLine - 1
	for size := 0; end < len(lines) && end-startLine+1 < maxLines; end++ {
		lineBytes := len(lines[end])
		if end > startLine-1 {
			lineBytes++ // separator between returned lines
		}
		if size+lineBytes > aitooloutput.StoredTextBytes {
			if end == startLine-1 {
				return "", fmt.Errorf("文件 %s 第 %d 行超过 %d 字节的单次输出限制，无法按整行返回；请使用有权限的命令按字节范围读取 (sha256=%s)", filePath, startLine, aitooloutput.StoredTextBytes, hash)
			}
			break
		}
		size += lineBytes
	}
	output := strings.Join(lines[startLine-1:end], "\n")
	next := ""
	if end < len(lines) {
		next = fmt.Sprintf("，继续读取请传 start_line=%d", end+1)
	}

	return fmt.Sprintf("文件内容 (%s，第 %d-%d 行，共 %d 行，sha256=%s%s):\n```\n%s\n```", filePath, startLine, end, len(lines), hash, next, output), nil
}
