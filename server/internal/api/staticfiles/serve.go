package staticfiles

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Serve 保留原始资源的 MIME 类型，按客户端偏好提供构建时生成的 br/gzip 文件。
// immutable 仅用于 Vite 的带内容哈希资源；HTML 和 public 文件必须重新验证。
func Serve(c *gin.Context, filename string, immutable bool) {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.Header("Allow", "GET, HEAD")
		c.Status(http.StatusMethodNotAllowed)
		return
	}

	file, err := os.Open(filename)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		c.Status(http.StatusNotFound)
		return
	}

	if immutable {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		c.Header("Cache-Control", "no-cache")
	}

	contentType := mime.TypeByExtension(filepath.Ext(filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Type", contentType)
	c.Writer.Header().Add("Vary", "Accept-Encoding")

	header := c.Request.Header.Get("Accept-Encoding")
	variants := []struct{ encoding, extension string }{{"br", ".br"}, {"gzip", ".gz"}}
	if encodingQuality(header, "gzip") > encodingQuality(header, "br") {
		variants[0], variants[1] = variants[1], variants[0]
	}
	for _, variant := range variants {
		if encodingQuality(header, variant.encoding) <= 0 {
			continue
		}
		if compressed, err := os.Open(filename + variant.extension); err == nil {
			defer compressed.Close()
			if compressedInfo, err := compressed.Stat(); err == nil && !compressedInfo.IsDir() {
				c.Header("Content-Encoding", variant.encoding)
				http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), compressed)
				return
			}
		}
	}

	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
}

func encodingQuality(header, requested string) float64 {
	wildcard := 0.0
	for _, entry := range strings.Split(header, ",") {
		parts := strings.Split(entry, ";")
		encoding := strings.ToLower(strings.TrimSpace(parts[0]))
		if encoding != requested && encoding != "*" {
			continue
		}
		quality := 1.0
		for _, parameter := range parts[1:] {
			name, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if ok && strings.EqualFold(strings.TrimSpace(name), "q") {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil || !(parsed >= 0 && parsed <= 1) {
					quality = 0
				} else {
					quality = parsed
				}
			}
		}
		// 显式的 q=0 优先于通配符。
		if encoding == requested {
			return quality
		}
		wildcard = quality
	}
	return wildcard
}
