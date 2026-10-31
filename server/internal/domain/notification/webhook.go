package notification

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// WebhookService Webhook 通知服务接口
type WebhookService interface {
	// SendNotification 发送 Webhook 通知
	SendNotification(ctx context.Context, event string, data map[string]interface{}) error
}

// WebhookConfig Webhook 配置
type WebhookConfig struct {
	URL    string // Webhook URL
	Secret string // 签名密钥（可选）
	Method string // HTTP 方法（POST 或 GET）
}

type webhookService struct {
	config *WebhookConfig
	client *http.Client
}

// NewWebhookService 创建 Webhook 服务
func NewWebhookService(config *WebhookConfig) (WebhookService, error) {
	if config.URL == "" {
		return nil, fmt.Errorf("webhook URL is required")
	}

	// 默认使用 POST 方法
	if config.Method == "" {
		config.Method = "POST"
	}

	return &webhookService{
		config: config,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}, nil
}

// WebhookPayload Webhook 请求负载
type WebhookPayload struct {
	Event     string                 `json:"event"`
	Timestamp int64                  `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

// WebhookSignatureHeader carries "sha256=" plus the hex HMAC-SHA256 of the
// exact payload bytes: the POST body, or the GET "data" query value. Receivers
// verify against the raw bytes instead of re-serializing JSON.
const WebhookSignatureHeader = "X-EasySSH-Signature"

// SendNotification 发送通知
func (s *webhookService) SendNotification(ctx context.Context, event string, data map[string]interface{}) error {
	timestamp := time.Now().Unix()
	body, err := json.Marshal(WebhookPayload{Event: event, Timestamp: timestamp, Data: data})
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	var req *http.Request
	if s.config.Method == "POST" {
		req, err = http.NewRequestWithContext(ctx, "POST", s.config.URL, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("failed to create notification request")
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		// GET 方法：将完整负载作为 data 查询参数
		req, err = http.NewRequestWithContext(ctx, "GET", s.config.URL, nil)
		if err != nil {
			return fmt.Errorf("failed to create notification request")
		}
		q := req.URL.Query()
		q.Set("event", event)
		q.Set("timestamp", fmt.Sprintf("%d", timestamp))
		q.Set("data", string(body))
		req.URL.RawQuery = q.Encode()
	}
	if s.config.Secret != "" {
		req.Header.Set(WebhookSignatureHeader, signWebhookPayload(s.config.Secret, body))
	}

	// 发送请求（带重试）
	return s.sendWithRetry(req, 3)
}

// sendWithRetry 带重试的发送
func (s *webhookService) sendWithRetry(req *http.Request, maxRetries int) error {
	var lastErr error
	for i := 0; i < maxRetries; i++ {
		if err := req.Context().Err(); err != nil {
			return err
		}
		attempt := req.Clone(req.Context())
		if i > 0 && req.GetBody != nil {
			body, err := req.GetBody()
			if err != nil {
				return err
			}
			attempt.Body = body
		}
		resp, err := s.client.Do(attempt)
		if err != nil {
			lastErr = notificationRequestError(err)
		} else {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
			lastErr = fmt.Errorf("webhook returned HTTP %d", resp.StatusCode)
			if resp.StatusCode >= 400 && resp.StatusCode < 500 {
				return lastErr
			}
		}
		if i+1 < maxRetries {
			timer := time.NewTimer(time.Duration(1<<uint(i)) * time.Second)
			select {
			case <-req.Context().Done():
				timer.Stop()
				return req.Context().Err()
			case <-timer.C:
			}
		}
	}
	return fmt.Errorf("webhook failed after %d attempts: %w", maxRetries, lastErr)
}

func signWebhookPayload(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// TestConnection 测试 Webhook 连接
func TestWebhookConnection(config *WebhookConfig) error {
	service, err := NewWebhookService(config)
	if err != nil {
		return err
	}

	// 发送测试通知
	testData := map[string]interface{}{
		"message": "This is a test notification from EasySSH",
		"source":  "EasySSH",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return service.SendNotification(ctx, "test", testData)
}
