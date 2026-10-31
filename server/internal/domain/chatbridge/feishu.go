package chatbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const feishuAPI = "https://open.feishu.cn/open-apis"

var feishuAppPattern = regexp.MustCompile(`^cli_[A-Za-z0-9]{8,64}$`)

type feishuError struct {
	Code   int
	Status int
}

func (e *feishuError) Error() string {
	return fmt.Sprintf("飞书请求失败（HTTP %d，错误码 %d），请检查应用凭据、机器人权限及发布状态", e.Status, e.Code)
}

// Never return raw HTTP/SDK errors or API descriptions: they may contain secrets.
func (s *Service) feishuRequest(ctx context.Context, method, path, token string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, feishuAPI+path, body)
	if err != nil {
		return errors.New("飞书请求创建失败")
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return errors.New("飞书连接失败，请检查网络或服务端代理设置")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return errors.New("飞书响应读取失败")
	}
	var envelope struct {
		Code *int `json:"code"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return errors.New("飞书返回了无法解析的响应")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || envelope.Code == nil || *envelope.Code != 0 {
		code := -1
		if envelope.Code != nil {
			code = *envelope.Code
		}
		return &feishuError{Code: code, Status: resp.StatusCode}
	}
	if output != nil {
		if err := json.Unmarshal(data, output); err != nil {
			return errors.New("飞书返回的数据格式无效")
		}
	}
	return nil
}

type feishuAccessToken struct {
	Token        string
	ExpiresAt    time.Time
	SecretCipher string
}

func (s *Service) requestFeishuToken(ctx context.Context, appID, secret string) (feishuAccessToken, error) {
	var result struct {
		Token  string `json:"tenant_access_token"`
		Expire int    `json:"expire"`
	}
	err := s.feishuRequest(ctx, http.MethodPost, "/auth/v3/tenant_access_token/internal", "", map[string]string{"app_id": appID, "app_secret": secret}, &result)
	if err != nil {
		return feishuAccessToken{}, err
	}
	if result.Token == "" || result.Expire <= 0 {
		return feishuAccessToken{}, errors.New("飞书未返回有效的应用访问凭据")
	}
	return feishuAccessToken{Token: result.Token, ExpiresAt: time.Now().Add(time.Duration(result.Expire)*time.Second - time.Minute)}, nil
}

func (s *Service) feishuToken(ctx context.Context, c Connection) (string, error) {
	s.feishuMu.Lock()
	defer s.feishuMu.Unlock()
	if cached, ok := s.feishuTokens[c.ID]; ok && cached.SecretCipher == c.TokenCipher && time.Now().Before(cached.ExpiresAt) {
		return cached.Token, nil
	}
	secret, err := s.token(c)
	if err != nil {
		return "", errors.New("飞书应用凭据无法解密")
	}
	token, err := s.requestFeishuToken(ctx, c.AppID, secret)
	if err != nil {
		return "", err
	}
	token.SecretCipher = c.TokenCipher
	s.feishuTokens[c.ID] = token
	return token.Token, nil
}

func (s *Service) inspectFeishuBot(ctx context.Context, appID, secret string) (string, error) {
	if !feishuAppPattern.MatchString(appID) {
		return "", invalid("飞书 App ID 格式无效")
	}
	if secret == "" || len(secret) > 1024 {
		return "", invalid("请提供有效的飞书 App Secret")
	}
	token, err := s.requestFeishuToken(ctx, appID, secret)
	if err != nil {
		return "", err
	}
	var result struct {
		Bot struct {
			AppName string `json:"app_name"`
			OpenID  string `json:"open_id"`
		} `json:"bot"`
	}
	if err := s.feishuRequest(ctx, http.MethodGet, "/bot/v3/info", token.Token, nil, &result); err != nil {
		return "", err
	}
	if result.Bot.OpenID == "" || result.Bot.AppName == "" {
		return "", invalid("飞书应用尚未启用机器人能力或机器人信息无效")
	}
	return truncate(result.Bot.AppName, 90), nil
}

func feishuCard(call outgoing) string {
	text, _ := call.payload["text"].(string)
	elements := []any{map[string]any{"tag": "div", "text": map[string]string{"tag": "lark_md", "content": text}}}
	if keyboard, ok := call.payload["reply_markup"].(*telegramKeyboard); ok {
		for _, row := range keyboard.Buttons {
			actions := make([]any, 0, len(row))
			for _, button := range row {
				kind := "primary"
				if strings.HasSuffix(button.Data, ":no") {
					kind = "danger"
				}
				actions = append(actions, map[string]any{"tag": "button", "text": map[string]string{"tag": "plain_text", "content": button.Text}, "type": kind, "value": map[string]string{"approval": button.Data}})
			}
			elements = append(elements, map[string]any{"tag": "action", "actions": actions})
		}
	}
	encoded, _ := json.Marshal(map[string]any{"config": map[string]bool{"wide_screen_mode": true, "update_multi": true}, "elements": elements})
	return string(encoded)
}

func (s *Service) sendFeishu(ctx context.Context, c Connection, token string, call outgoing) (any, error) {
	method, path := http.MethodPost, "/im/v1/messages?receive_id_type=chat_id"
	payload := map[string]any{"receive_id": call.payload["chat_id"], "msg_type": "interactive", "content": feishuCard(call), "uuid": uuid.NewString()}
	if call.method == "editMessageText" {
		messageID, ok := call.payload["message_id"].(string)
		if !ok || messageID == "" {
			return nil, errors.New("飞书待更新消息 ID 无效")
		}
		method, path = http.MethodPatch, "/im/v1/messages/"+url.PathEscape(messageID)
		payload = map[string]any{"content": feishuCard(call)}
	}
	for attempt := 1; ; attempt++ {
		var result struct {
			Data struct {
				MessageID string `json:"message_id"`
			} `json:"data"`
		}
		err := s.feishuRequest(ctx, method, path, token, payload, &result)
		if err == nil {
			if result.Data.MessageID == "" {
				return nil, nil
			}
			return result.Data.MessageID, nil
		}
		var apiErr *feishuError
		retryable := !errors.As(err, &apiErr) || apiErr.Status == 429 || apiErr.Status >= 500 || apiErr.Code == 99991400
		if apiErr != nil && (apiErr.Status == 401 || apiErr.Code == 99991663 || apiErr.Code == 99991664 || apiErr.Code == 99991668) {
			s.feishuMu.Lock()
			delete(s.feishuTokens, c.ID)
			s.feishuMu.Unlock()
			if refreshed, refreshErr := s.feishuToken(ctx, c); refreshErr == nil {
				token, retryable = refreshed, true
			}
		}
		if ctx.Err() != nil || !retryable || attempt == 3 || !wait(ctx, time.Duration(attempt*2)*time.Second) {
			log.Printf("chat feishu %s failed: %v", call.method, err)
			return nil, err
		}
	}
}
