package chatbridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/aiprovider"
)

type feishuTransport func(*http.Request) (*http.Response, error)

func (send feishuTransport) RoundTrip(req *http.Request) (*http.Response, error) { return send(req) }

func TestFeishuPostImages(t *testing.T) {
	post := `{"title":"排查","content":[[{"tag":"at","user_id":"bot"},{"tag":"text","text":"看截图"}],[{"tag":"img","image_key":"img_a"},{"tag":"img","image_key":"img_b"}]]}`
	for _, raw := range []string{post, `{"zh_cn":` + post + `}`} {
		text, resources, err := feishuContent("post", raw, "om_post")
		if err != nil || text != "排查\n看截图" || len(resources) != 2 || resources[0].key != "img_a" || resources[1].messageID != "om_post" {
			t.Fatalf("parsed post: %q, %+v, %v", text, resources, err)
		}
	}
}

func TestFeishuTextExcerptLimits(t *testing.T) {
	text := strings.Repeat("a", feishuTextBytes-1) + "错误"
	excerpt, err := feishuTextExcerpt("server.log", []byte(text))
	if err != nil || !strings.Contains(excerpt, "已截断") || !strings.HasSuffix(excerpt, text[:feishuTextBytes-1]) {
		t.Fatal("truncation did not preserve the UTF-8 boundary")
	}
	if _, err := feishuTextExcerpt("server.log", []byte("ok\x00")); err == nil {
		t.Fatal("binary file accepted as text")
	}
}

func TestFeishuQuotedFileWithInlineImage(t *testing.T) {
	const photo = "\x89PNG\r\n\x1a\nexample"
	for _, chatID := range []string{"oc_same", "oc_other"} {
		var downloads int
		transport := feishuTransport(func(req *http.Request) (*http.Response, error) {
			if req.Header.Get("Authorization") != "Bearer test" || req.URL.Host != "open.feishu.cn" {
				t.Fatal("invalid resource endpoint or token")
			}
			var body string
			switch req.URL.RequestURI() {
			case "/open-apis/im/v1/messages/om_parent":
				raw, _ := json.Marshal(map[string]any{"code": 0, "data": map[string]any{"items": []any{map[string]any{"message_id": "om_parent", "chat_id": chatID, "msg_type": "file", "body": map[string]string{"content": `{"file_name":"server.log","file_key":"file_log"}`}}}}})
				body = string(raw)
			case "/open-apis/im/v1/messages/om_now/resources/img_a?type=image":
				downloads++
				body = photo
			case "/open-apis/im/v1/messages/om_parent/resources/file_log?type=file":
				downloads++
				body = "disk full"
			default:
				t.Fatalf("unexpected API: %s", req.URL.RequestURI())
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
		})
		service := Service{http: &http.Client{Transport: transport}, feishuTokens: map[string]feishuAccessToken{"conn": {Token: "test", ExpiresAt: time.Now().Add(time.Hour)}}}
		media := feishuMedia{parentID: "om_parent", resources: []feishuResource{{"om_now", "img_a", "image", "截图"}}}
		err := service.loadFeishuMedia(context.Background(), Connection{ID: "conn"}, "oc_same", &media)
		if chatID != "oc_same" {
			if err == nil || downloads != 0 {
				t.Fatal("accepted a quote from a different chat")
			}
		} else if err != nil || downloads != 2 || len(media.images) != 1 || media.images[0].Data != base64.StdEncoding.EncodeToString([]byte(photo)) || len(media.excerpts) != 1 || !strings.Contains(media.excerpts[0], "disk full") {
			t.Fatalf("missing image or quoted text: %+v, %v", media, err)
		}
	}
}

func TestExpandedImageCount(t *testing.T) {
	image := aiprovider.Attachment{MediaType: "image/png", Data: "YQ==", Size: 1}
	images := make([]aiprovider.Attachment, 10)
	for index := range images {
		images[index] = image
	}
	if err := aiprovider.ValidateAttachments(images); err != nil {
		t.Fatal(err)
	}
	if err := aiprovider.ValidateAttachments(append(images, image)); err == nil {
		t.Fatal("eleventh image accepted")
	}
}
