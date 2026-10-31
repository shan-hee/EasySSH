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
	"regexp"
	"strings"
	"time"
)

var tokenPattern = regexp.MustCompile(`^[0-9]{5,20}:[A-Za-z0-9_-]{20,100}$`)

type telegramUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}
type telegramMessage struct {
	MessageID int64        `json:"message_id"`
	From      telegramUser `json:"from"`
	Chat      struct {
		ID   int64  `json:"id"`
		Type string `json:"type"`
	} `json:"chat"`
	Text string `json:"text"`
}
type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message"`
	Callback *struct {
		ID      string           `json:"id"`
		From    telegramUser     `json:"from"`
		Message *telegramMessage `json:"message"`
		Data    string           `json:"data"`
	} `json:"callback_query"`
}
type telegramButton struct {
	Text string `json:"text"`
	Data string `json:"callback_data"`
}
type telegramKeyboard struct {
	Buttons [][]telegramButton `json:"inline_keyboard"`
}

type telegramError struct {
	Code       int
	RetryAfter int
}

func (e *telegramError) Error() string {
	switch e.Code {
	case 401:
		return "Telegram 凭据无效，请更新 Bot Token"
	case 403:
		return "Telegram 拒绝发送消息，机器人可能已被屏蔽"
	case 409:
		return "Telegram 接收冲突：请停用同一机器人的其他轮询或 Webhook"
	case 429:
		return "Telegram 请求限流，稍后重试"
	default:
		return fmt.Sprintf("Telegram 请求失败（%d）", e.Code)
	}
}

// Never expose transport errors: net/http errors contain the URL and bot token.
func (s *Service) telegram(ctx context.Context, token, method string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/"+method, bytes.NewReader(body))
	if err != nil {
		return errors.New("无法创建 Telegram 请求")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := s.http.Do(req)
	if err != nil {
		return errors.New("无法连接 Telegram，请检查网络或服务端代理设置")
	}
	defer response.Body.Close()
	var envelope struct {
		OK         bool            `json:"ok"`
		Result     json.RawMessage `json:"result"`
		ErrorCode  int             `json:"error_code"`
		Parameters struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&envelope); err != nil {
		return errors.New("Telegram 返回了无法解析的响应")
	}
	if !envelope.OK {
		code := envelope.ErrorCode
		if code == 0 {
			code = response.StatusCode
		}
		return &telegramError{Code: code, RetryAfter: envelope.Parameters.RetryAfter}
	}
	if output != nil {
		return json.Unmarshal(envelope.Result, output)
	}
	return nil
}

func (s *Service) inspectBot(ctx context.Context, token string) (telegramUser, error) {
	var bot telegramUser
	if !tokenPattern.MatchString(token) {
		return bot, invalid("Bot Token 格式无效")
	}
	if err := s.telegram(ctx, token, "getMe", struct{}{}, &bot); err != nil {
		return bot, err
	}
	if !bot.IsBot || bot.ID == 0 || bot.Username == "" {
		return bot, invalid("Telegram 机器人信息无效")
	}
	var webhook struct {
		URL string `json:"url"`
	}
	if err := s.telegram(ctx, token, "getWebhookInfo", struct{}{}, &webhook); err != nil {
		return bot, err
	}
	if webhook.URL != "" {
		return bot, invalid("此机器人已配置 Webhook，请先解除该配置或使用专用机器人")
	}
	return bot, nil
}

// outgoing is a Telegram call prepared while holding s.mu and sent after it is
// released, so slow Telegram requests never block dispatch or management.
type outgoing struct {
	method  string
	payload map[string]any
}

type delivery struct {
	connection Connection
	calls      []outgoing
}

// reply splits text into chunks Telegram accepts; buttons stay on the last chunk.
func reply(chatID int64, text string, keyboard *telegramKeyboard) []outgoing {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	// 1,600 Unicode code points also fit Telegram's UTF-16 length accounting.
	runes := []rune(text)
	var calls []outgoing
	for start := 0; start < len(runes); start += 1600 {
		end := min(start+1600, len(runes))
		payload := map[string]any{"chat_id": chatID, "text": string(runes[start:end]), "link_preview_options": map[string]bool{"is_disabled": true}}
		if end == len(runes) && keyboard != nil {
			payload["reply_markup"] = keyboard
		}
		calls = append(calls, outgoing{method: "sendMessage", payload: payload})
	}
	return calls
}

func (s *Service) enqueue(c Connection, calls []outgoing) {
	if len(calls) == 0 {
		return
	}
	select {
	case s.replies <- delivery{connection: c, calls: calls}:
	default:
		log.Printf("chat reply queue full; dropped %d messages for connection %s", len(calls), c.ID)
	}
}

// Replies are best-effort and kept in memory only. A restart or a long Telegram
// outage drops them; the web UI stays the source of truth for Agent results.
// A single sender keeps replies in the order they were produced.
func (s *Service) sendReplies(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case d := <-s.replies:
			token, err := s.token(d.connection)
			if err != nil {
				log.Printf("chat connection %s token unavailable: %v", d.connection.ID, err)
				continue
			}
			for _, call := range d.calls {
				s.call(ctx, token, call)
			}
		}
	}
}

func (s *Service) call(ctx context.Context, token string, call outgoing) {
	for attempt := 1; ; attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := s.telegram(callCtx, token, call.method, call.payload, nil)
		cancel()
		if err == nil || ctx.Err() != nil {
			return
		}
		var apiErr *telegramError
		retryable := !errors.As(err, &apiErr) || apiErr.Code == 429 || apiErr.Code >= 500
		delay := time.Duration(attempt*2) * time.Second
		if apiErr != nil {
			delay = max(delay, time.Duration(apiErr.RetryAfter)*time.Second)
		}
		if !retryable || attempt == 3 || !wait(ctx, delay) {
			// sendMessage has no idempotency key; an ambiguous failure may still have
			// been delivered, but it can never re-dispatch an Agent operation.
			log.Printf("chat %s failed: %v", call.method, err)
			return
		}
	}
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
