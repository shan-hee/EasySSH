// Package aitooloutput prepares remote output for text display and model input.
package aitooloutput

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// StoredTextBytes bounds readable output retained when a tool collects results.
// Model requests do not apply an additional text-size budget.
const StoredTextBytes = 48 * 1024

var terminalEscape = regexp.MustCompile(`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))`)

// Sanitize detects binary data before JSON encoding can turn it into a large
// sequence of escapes. It never changes the command's exit status.
func Sanitize(output string) string {
	originalBytes := len(output)
	output = terminalEscape.ReplaceAllString(output, "")
	if strings.IndexByte(output, 0) >= 0 || !utf8.ValidString(output) {
		return binaryNotice(originalBytes)
	}
	controls := 0
	for _, r := range output {
		if r < 32 && r != '\n' && r != '\r' && r != '\t' || r == 127 {
			controls++
		}
	}
	if controls > 0 && controls*100 > len(output) {
		return binaryNotice(originalBytes)
	}
	if controls > 0 {
		output = strings.Map(func(r rune) rune {
			if r < 32 && r != '\n' && r != '\r' && r != '\t' || r == 127 {
				return -1
			}
			return r
		}, output)
	}
	return output
}

func binaryNotice(size int) string {
	return fmt.Sprintf("[检测到二进制或非 UTF-8 输出，已省略 %d 字节。请用 file 等工具确认类型，按需提取文本信息；此提示不代表命令执行失败。]", size)
}

// Truncate keeps both the beginning and end of text within a UTF-8 byte budget,
// including the omission notice. Tail output often contains the final error.
func Truncate(text string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(text) <= maxBytes {
		return text
	}
	notice := fmt.Sprintf("\n[输出已截断，原文 %d 字节；需要更多内容时请按范围重新读取。]\n", len(text))
	if len(notice) >= maxBytes {
		return prefix(notice, maxBytes)
	}
	remaining := maxBytes - len(notice)
	head := prefix(text, remaining/2)
	tailStart := len(text) - (remaining - len(head))
	for tailStart < len(text) && !utf8.RuneStart(text[tailStart]) {
		tailStart++
	}
	return head + notice + text[tailStart:]
}

func prefix(text string, size int) string {
	if size >= len(text) {
		return text
	}
	for size > 0 && !utf8.RuneStart(text[size]) {
		size--
	}
	return text[:size]
}
