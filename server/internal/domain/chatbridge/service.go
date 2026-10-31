package chatbridge

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrInvalid = errors.New("invalid chat connection")

const (
	ProviderTelegram = "telegram"
	ProviderFeishu   = "feishu"
)

func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }

type Service struct {
	db            *gorm.DB
	encryptor     *crypto.Encryptor
	agent         *runtime.Manager
	accessRuntime *access.Runtime
	http          *http.Client
	mu            sync.Mutex // Serializes dispatch, projection and management changes, never platform I/O.
	replies       chan delivery
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	feishuMu      sync.Mutex
	feishuTokens  map[string]feishuAccessToken
}

func NewService(db *gorm.DB, encryptor *crypto.Encryptor, agent *runtime.Manager, accessRuntime *access.Runtime) *Service {
	return &Service{db: db, encryptor: encryptor, agent: agent, accessRuntime: accessRuntime, replies: make(chan delivery, 256), feishuTokens: make(map[string]feishuAccessToken),
		http: &http.Client{Timeout: 35 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func owner(ctx context.Context) (string, error) {
	scope := access.Current(ctx)
	if err := scope.RequireOwner(ctx, protocol.OwnerManage); err != nil {
		return "", err
	}
	return scope.Actor().ID, nil
}

func (s *Service) connection(ctx context.Context, id string) (Connection, error) {
	ownerID, err := owner(ctx)
	if err != nil {
		return Connection{}, err
	}
	var c Connection
	err = s.db.WithContext(ctx).Where("id = ? AND owner_id = ?", id, ownerID).First(&c).Error
	return c, err
}

func (s *Service) token(c Connection) (string, error) {
	return s.encryptor.DecryptSecret(c.TokenCipher, crypto.SecretAAD("chat_connections", c.ID, "token_cipher"))
}

func view(c Connection) (ConnectionView, error) {
	v := ConnectionView{Connection: c, ServerIDs: []string{}, Status: "disabled"}
	if err := json.Unmarshal([]byte(c.ServerIDsJSON), &v.ServerIDs); err != nil {
		return v, err
	}
	if c.Enabled {
		v.Status = "connecting"
		if c.LastError != "" {
			v.Status = "error"
		} else if c.LastPollAt != nil && time.Since(*c.LastPollAt) < 90*time.Second {
			v.Status = "connected"
		}
	}
	return v, nil
}

func (s *Service) List(ctx context.Context) ([]ConnectionView, error) {
	ownerID, err := owner(ctx)
	if err != nil {
		return nil, err
	}
	var rows []Connection
	if err := s.db.WithContext(ctx).Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	views := make([]ConnectionView, 0, len(rows))
	for _, row := range rows {
		v, err := view(row)
		if err != nil {
			return nil, err
		}
		views = append(views, v)
	}
	return views, nil
}

func (s *Service) Detail(ctx context.Context, id string) (Detail, error) {
	c, err := s.connection(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	v, err := view(c)
	if err != nil {
		return Detail{}, err
	}
	d := Detail{Connection: v, Bindings: []Binding{}}
	err = s.db.WithContext(ctx).Where("connection_id = ?", id).Order("created_at DESC").Find(&d.Bindings).Error
	return d, err
}

func (s *Service) Save(ctx context.Context, id string, input ConnectionInput) (ConnectionView, error) {
	ownerID, err := owner(ctx)
	if err != nil {
		return ConnectionView{}, err
	}
	input.Name, input.Token = strings.TrimSpace(input.Name), strings.TrimSpace(input.Token)
	if input.Name == "" || len(input.Name) > 100 {
		return ConnectionView{}, invalid("连接名称须为 1–100 字节")
	}
	if input.PermissionMode != "readonly" && input.PermissionMode != "balanced" {
		return ConnectionView{}, invalid("仅支持只读或需审批模式")
	}
	slices.Sort(input.ServerIDs)
	input.ServerIDs = slices.Compact(input.ServerIDs)
	if len(input.ServerIDs) == 0 || len(input.ServerIDs) > 100 {
		return ConnectionView{}, invalid("请选择 1–100 台服务器")
	}
	for _, serverID := range input.ServerIDs {
		if parsed, err := uuid.Parse(serverID); err != nil || parsed.String() != serverID {
			return ConnectionView{}, invalid("服务器 ID 无效")
		}
	}
	var count int64
	if err := s.db.WithContext(ctx).Table("servers").Where("id IN ?", input.ServerIDs).Count(&count).Error; err != nil {
		return ConnectionView{}, err
	}
	if count != int64(len(input.ServerIDs)) {
		return ConnectionView{}, invalid("所选服务器已不存在")
	}
	var existing Connection
	if id != "" {
		existing, err = s.connection(ctx, id)
		if err != nil {
			return ConnectionView{}, err
		}
	}
	input.Provider = strings.TrimSpace(input.Provider)
	if input.Provider == "" {
		input.Provider = existing.Provider
		if input.Provider == "" {
			input.Provider = ProviderTelegram
		}
	}
	if input.Provider != ProviderTelegram && input.Provider != ProviderFeishu {
		return ConnectionView{}, invalid("仅支持 Telegram 或飞书接入")
	}
	if id != "" && input.Provider != existing.Provider {
		return ConnectionView{}, invalid("更换聊天平台请新建连接")
	}
	bot, err := s.verify(ctx, &input, existing)
	if err != nil {
		return ConnectionView{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.db.WithContext(ctx).Model(&Connection{}).Where("bot_id = ? AND id <> ?", bot.id, id).Count(&count).Error; err != nil {
		return ConnectionView{}, err
	}
	if count > 0 {
		return ConnectionView{}, invalid("此机器人已有连接")
	}
	encoded, _ := json.Marshal(input.ServerIDs)
	c := existing
	if id == "" {
		if err := s.db.WithContext(ctx).Model(&Connection{}).Count(&count).Error; err != nil {
			return ConnectionView{}, err
		}
		if count >= 10 {
			return ConnectionView{}, invalid("最多配置 10 个聊天连接")
		}
		c.ID, c.OwnerID, c.CreatedAt = uuid.NewString(), ownerID, time.Now().UTC()
		c.Revision = 1
	}
	c.Name, c.ServerIDsJSON, c.PermissionMode, c.Enabled = input.Name, string(encoded), input.PermissionMode, input.Enabled
	c.Provider, c.AppID = input.Provider, input.AppID
	c.BotID, c.BotUsername, c.UpdatedAt = bot.id, bot.name, time.Now().UTC()
	c.LastError = ""
	c.TokenCipher, err = s.encryptor.EncryptSecret(bot.secret, crypto.SecretAAD("chat_connections", c.ID, "token_cipher"))
	if err != nil {
		return ConnectionView{}, err
	}
	if id == "" {
		err = s.db.WithContext(ctx).Create(&c).Error
	} else {
		// Keep the polling cursor; invalidate outstanding links when permissions change.
		result := s.db.WithContext(ctx).Model(&Connection{}).Where("id = ? AND owner_id = ?", id, ownerID).Updates(map[string]any{
			"name": c.Name, "token_cipher": c.TokenCipher, "bot_username": c.BotUsername, "server_ids_json": c.ServerIDsJSON,
			"permission_mode": c.PermissionMode, "enabled": c.Enabled, "updated_at": c.UpdatedAt, "last_error": "", "bind_code_hash": "", "bind_expires_at": nil, "revision": gorm.Expr("revision + 1"), "last_poll_at": nil,
		})
		err = result.Error
		if err == nil && result.RowsAffected == 0 {
			err = gorm.ErrRecordNotFound
		}
		if err == nil {
			err = s.cancelConnection(ctx, id)
		}
	}
	if err != nil {
		return ConnectionView{}, err
	}
	return view(c)
}

// botIdentity is what a platform credential resolves to.
type botIdentity struct {
	id     int64
	name   string
	secret string
}

// verify checks the credential with the platform. On update an empty credential
// keeps the stored one, and the bot or application itself cannot change.
func (s *Service) verify(ctx context.Context, input *ConnectionInput, existing Connection) (botIdentity, error) {
	secret := input.Token
	if input.Provider == ProviderFeishu {
		secret = strings.TrimSpace(input.AppSecret)
	}
	if existing.ID != "" && secret == "" {
		stored, err := s.token(existing)
		if err != nil {
			return botIdentity{}, err
		}
		secret = stored
	}
	if input.Provider == ProviderFeishu {
		input.AppID = strings.TrimSpace(input.AppID)
		if existing.ID != "" && input.AppID == "" {
			input.AppID = existing.AppID
		}
		if existing.ID != "" && input.AppID != existing.AppID {
			return botIdentity{}, invalid("更换飞书应用请新建连接")
		}
		name, err := s.inspectFeishuBot(ctx, input.AppID, secret)
		// bot_id stays a unique NOT NULL column from schema 8. Feishu's identity is
		// the unique (provider, app_id); a negative hash never collides with Telegram.
		digest := sha256.Sum256([]byte("feishu:" + input.AppID))
		return botIdentity{id: -int64(binary.BigEndian.Uint64(digest[:8])>>1) - 1, name: name, secret: secret}, err
	}
	if input.AppID != "" || input.AppSecret != "" {
		return botIdentity{}, invalid("Telegram 连接不接受飞书应用凭据")
	}
	bot, err := s.inspectBot(ctx, secret)
	if err == nil && existing.ID != "" && bot.ID != existing.BotID {
		return botIdentity{}, invalid("更换机器人请新建连接；此处仅支持同一机器人的 Token 更新")
	}
	return botIdentity{id: bot.ID, name: bot.Username, secret: secret}, err
}

func platformName(c Connection) string {
	if c.Provider == ProviderFeishu {
		return "飞书"
	}
	return "Telegram"
}

func (s *Service) SetEnabled(ctx context.Context, id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.connection(ctx, id)
	if err != nil {
		return err
	}
	if enabled && c.Enabled {
		return nil
	}
	if err := s.db.WithContext(ctx).Model(&c).Updates(map[string]any{"enabled": enabled, "last_error": "", "bind_code_hash": "", "bind_expires_at": nil, "revision": gorm.Expr("revision + 1"), "last_poll_at": nil}).Error; err != nil {
		return err
	}
	if !enabled {
		return s.cancelConnection(ctx, id)
	}
	return nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.connection(ctx, id)
	if err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Model(&c).Update("enabled", false).Error; err != nil {
		return err
	}
	if err := s.cancelConnection(ctx, id); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Delete(&c).Error
}

func (s *Service) cancelConnection(ctx context.Context, id string) error {
	var bindings []Binding
	if err := s.db.WithContext(ctx).Where("connection_id = ?", id).Find(&bindings).Error; err != nil {
		return err
	}
	for _, b := range bindings {
		if err := s.cancelBinding(ctx, b); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) cancelBinding(ctx context.Context, b Binding) error {
	s.accessRuntime.Invalidate("", b.ID, "", access.ErrRevoked)
	if b.Watching {
		if err := s.agent.CancelSession(ctx, b.CurrentSessionID); err != nil && !errors.Is(err, runtime.ErrSessionNotFound) && !errors.Is(err, runtime.ErrSessionClosed) {
			return err
		}
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Approval{}).Where("binding_id = ? AND used_at IS NULL", b.ID).Update("used_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		return tx.Model(&Binding{}).Where("id = ?", b.ID).Update("watching", false).Error
	})
}

func (s *Service) Revoke(ctx context.Context, connectionID, bindingID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.connection(ctx, connectionID); err != nil {
		return err
	}
	var b Binding
	if err := s.db.WithContext(ctx).Where("id = ? AND connection_id = ?", bindingID, connectionID).First(&b).Error; err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Model(&b).Update("revoked_at", time.Now().UTC()).Error; err != nil {
		return err
	}
	return s.cancelBinding(ctx, b)
}

func (s *Service) CreateBindCode(ctx context.Context, id string) (BindCode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.connection(ctx, id)
	if err != nil {
		return BindCode{}, err
	}
	if !c.Enabled {
		return BindCode{}, invalid("请先启用连接")
	}
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return BindCode{}, err
	}
	code := base64.RawURLEncoding.EncodeToString(secret)
	expires := time.Now().UTC().Add(10 * time.Minute)
	err = s.db.WithContext(ctx).Model(&c).Updates(map[string]any{"bind_code_hash": hash(code), "bind_expires_at": expires}).Error
	link := "https://t.me/" + c.BotUsername + "?start=bind_" + code
	if c.Provider == ProviderFeishu {
		link = "https://applink.feishu.cn/client/bot/open?appId=" + url.QueryEscape(c.AppID)
	}
	return BindCode{Code: code, URL: link, Command: "/bind " + code, ExpiresAt: expires}, err
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func stableID(value string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("chat:"+value)).String()
}
