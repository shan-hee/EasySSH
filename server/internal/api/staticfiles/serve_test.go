package staticfiles

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestServeEncodingNegotiation(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "app-hash.js")
	body := []byte(`console.log("local");`)
	// 真实 Brotli 数据；完整构建产物另行进行解压一致性检查。
	br, err := hex.DecodeString("0b0a80636f6e736f6c652e6c6f6728226c6f63616c22293b03")
	if err != nil {
		t.Fatal(err)
	}
	var gz bytes.Buffer
	writer := gzip.NewWriter(&gz)
	if _, err := writer.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	for suffix, data := range map[string][]byte{"": body, ".br": br, ".gz": gz.Bytes()} {
		if err := os.WriteFile(filename+suffix, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		accept, encoding string
		body             []byte
	}{
		{"gzip, br", "br", br},
		{"br;q=0.5, gzip;q=1", "gzip", gz.Bytes()},
		{"br;q=0, gzip", "gzip", gz.Bytes()},
		{"gzip;q=0, *;q=1", "br", br},
		{"br;q=0, gzip;q=0, *;q=1", "", body},
		{"", "", body},
	} {
		t.Run(tc.accept, func(t *testing.T) {
			router := gin.New()
			router.GET("/asset", func(c *gin.Context) { Serve(c, filename, true) })
			request := httptest.NewRequest(http.MethodGet, "/asset", nil)
			request.Header.Set("Accept-Encoding", tc.accept)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != 200 || response.Header().Get("Content-Encoding") != tc.encoding {
				t.Fatalf("unexpected response: status %d, encoding %q", response.Code, response.Header().Get("Content-Encoding"))
			}
			if !bytes.Equal(response.Body.Bytes(), tc.body) {
				t.Fatal("wrong encoded representation")
			}
		})
	}
	if err := os.Remove(filename + ".br"); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/asset", func(c *gin.Context) { Serve(c, filename, true) })
	request := httptest.NewRequest(http.MethodGet, "/asset", nil)
	request.Header.Set("Accept-Encoding", "br, gzip")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("missing Brotli file should use available gzip")
	}
}

func TestAcceptsGzip(t *testing.T) {
	for _, tc := range []struct {
		header string
		want   bool
	}{
		{"", false},
		{"br", false},
		{"gzip, deflate, br", true},
		{"GZIP; q=0.5", true},
		{"gzip;q=0", false},
		{"*;q=0.5", true},
		{"*;q=0", false},
		{"*;q=1, gzip;q=0", false},
		{"gzip;q=0, *;q=1", false},
		{"gzip;q=1, *;q=0", true},
		{"gzip;q=invalid", false},
		{"gzip;q=NaN", false},
		{"gzip;q=-1", false},
		{"gzip;q=2", false},
	} {
		t.Run(tc.header, func(t *testing.T) {
			if got := (encodingQuality(tc.header, "gzip") > 0); got != tc.want {
				t.Fatalf("acceptsGzip(%q) = %v, want %v", tc.header, got, tc.want)
			}
		})
	}
}

func TestServe(t *testing.T) {
	dir := t.TempDir()
	body := []byte(strings.Repeat("console.log('静态资源');\n", 100))
	modified := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"app-hash.js", "index.html", "style.css", "plain.js"} {
		filename := filepath.Join(dir, name)
		if err := os.WriteFile(filename, body, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(filename, modified, modified); err != nil {
			t.Fatal(err)
		}
		if name != "plain.js" {
			if err := os.WriteFile(filename+".gz", compressed.Bytes(), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}

	for _, tc := range []struct {
		name        string
		file        string
		method      string
		accept      string
		immutable   bool
		conditional bool
		wantStatus  int
		wantGzip    bool
		wantMIME    string
	}{
		{name: "gzip asset", file: "app-hash.js", accept: "gzip", immutable: true, wantStatus: 200, wantGzip: true, wantMIME: "javascript"},
		{name: "uncompressed asset", file: "app-hash.js", immutable: true, wantStatus: 200, wantMIME: "javascript"},
		{name: "explicitly reject gzip", file: "app-hash.js", accept: "*;q=1,gzip;q=0", immutable: true, wantStatus: 200, wantMIME: "javascript"},
		{name: "missing compressed variant", file: "plain.js", accept: "gzip", wantStatus: 200, wantMIME: "javascript"},
		{name: "html revalidates", file: "index.html", accept: "gzip", wantStatus: 200, wantGzip: true, wantMIME: "text/html"},
		{name: "css retains MIME", file: "style.css", accept: "gzip", immutable: true, wantStatus: 200, wantGzip: true, wantMIME: "text/css"},
		{name: "head", file: "app-hash.js", method: http.MethodHead, accept: "gzip", immutable: true, wantStatus: 200, wantGzip: true, wantMIME: "javascript"},
		{name: "not modified", file: "index.html", accept: "gzip", conditional: true, wantStatus: 304},
		{name: "missing asset", file: "missing.js", immutable: true, wantStatus: 404},
		{name: "directory", file: ".", wantStatus: 404},
		{name: "unsupported method", file: "app-hash.js", method: http.MethodPost, wantStatus: 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			method := tc.method
			if method == "" {
				method = http.MethodGet
			}
			request := httptest.NewRequest(method, "/requested-path", nil)
			request.Header.Set("Accept-Encoding", tc.accept)
			if tc.conditional {
				request.Header.Set("If-Modified-Since", modified.Format(http.TimeFormat))
			}
			response := httptest.NewRecorder()
			router := gin.New()
			// HTML/public 文件使用 NoRoute；验证成功响应覆盖 Gin 的默认 404。
			router.NoRoute(func(c *gin.Context) {
				Serve(c, filepath.Join(dir, tc.file), tc.immutable)
			})
			router.ServeHTTP(response, request)
			if response.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, tc.wantStatus)
			}
			if tc.wantStatus >= 400 {
				if response.Header().Get("Cache-Control") != "" {
					t.Fatal("error response must not get the asset cache policy")
				}
				if tc.wantStatus == 405 && response.Header().Get("Allow") != "GET, HEAD" {
					t.Fatal("missing allowed methods")
				}
				return
			}
			wantCache := "no-cache"
			if tc.immutable {
				wantCache = "public, max-age=31536000, immutable"
			}
			if response.Header().Get("Cache-Control") != wantCache {
				t.Fatalf("unexpected cache policy: %s", response.Header().Get("Cache-Control"))
			}
			if response.Header().Get("Vary") != "Accept-Encoding" {
				t.Fatal("compressed and plain responses must vary by Accept-Encoding")
			}
			if tc.wantStatus == 304 {
				if response.Body.Len() != 0 {
					t.Fatal("304 response must not contain a body")
				}
				return
			}
			if !strings.Contains(response.Header().Get("Content-Type"), tc.wantMIME) {
				t.Fatalf("unexpected MIME: %s", response.Header().Get("Content-Type"))
			}
			if got := response.Header().Get("Content-Encoding") == "gzip"; got != tc.wantGzip {
				t.Fatalf("gzip = %v, want %v", got, tc.wantGzip)
			}
			if method == http.MethodHead {
				if response.Body.Len() != 0 {
					t.Fatal("HEAD response must not contain a body")
				}
				return
			}
			actual := response.Body.Bytes()
			if tc.wantGzip {
				reader, err := gzip.NewReader(bytes.NewReader(actual))
				if err != nil {
					t.Fatal(err)
				}
				defer reader.Close()
				actual, err = io.ReadAll(reader)
				if err != nil {
					t.Fatal(err)
				}
			}
			if !bytes.Equal(actual, body) {
				t.Fatal("served content differs from original")
			}
		})
	}
}
