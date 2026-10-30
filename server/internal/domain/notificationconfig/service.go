package notificationconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/easyssh/server/internal/domain/notification"
	"github.com/easyssh/server/internal/pkg/mailclient"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/secretcrypto"
)

var ErrInvalidConfig = errors.New("invalid notification configuration")
var ErrConnectionTest = errors.New("notification connection test failed")

type Service interface {
	GetSMTPConfig(context.Context) (*SMTPConfig, error)
	GetWebhookConfig(context.Context) (*WebhookConfig, error)
	GetDingTalkConfig(context.Context) (*DingTalkConfig, error)
	GetWeComConfig(context.Context) (*WeComConfig, error)
	GetAllConfig(context.Context) (*AllNotificationConfig, error)
	SaveAllConfig(context.Context, *protocol.NotificationConfigUpdate) error
	TestSMTPConnection(context.Context, *protocol.SMTPConfigUpdate) error
	TestWebhookConnection(context.Context, *protocol.WebhookConfigUpdate) error
	TestDingTalkConnection(context.Context, *protocol.DingTalkConfigUpdate) error
	TestWeComConnection(context.Context, *protocol.WeComConfigUpdate) error
}

type service struct {
	repo      Repository
	encryptor *crypto.Encryptor
}

func NewService(repo Repository, encryptor *crypto.Encryptor) Service {
	return &service{repo: repo, encryptor: encryptor}
}

// Malformed stored configuration is an error, never silently replaced by disabled defaults.
func decodeNotificationConfig(raw string, value any) error {
	if strings.TrimSpace(raw) == "null" {
		return errors.New("stored notification configuration is null")
	}
	if err := json.Unmarshal([]byte(raw), value); err != nil {
		return errors.New("stored notification configuration is invalid")
	}
	return nil
}

func (s *service) cryptField(value *string, section, field string, decrypt bool) error {
	if *value == "" {
		return nil
	}
	if s.encryptor == nil {
		return errors.New("notification credential encryption is unavailable")
	}
	var result string
	var err error
	aad := crypto.SecretAAD("notification_config", section, field)
	if decrypt {
		result, err = s.encryptor.DecryptSecret(*value, aad)
	} else {
		result, err = s.encryptor.EncryptSecret(*value, aad)
	}
	if err != nil {
		return fmt.Errorf("notification credential %s.%s: %w", section, field, err)
	}
	*value = result
	return nil
}

func (s *service) readSMTP(raw string) (*SMTPConfig, error) {
	var config SMTPConfig
	if err := decodeNotificationConfig(raw, &config); err != nil {
		return nil, err
	}
	if err := s.cryptField(&config.Password, "smtp", "password", true); err != nil {
		return nil, err
	}
	return &config, nil
}

func (s *service) GetSMTPConfig(ctx context.Context) (*SMTPConfig, error) {
	row, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	return s.readSMTP(row.SMTPConfig)
}

func (s *service) readWebhook(raw string) (*WebhookConfig, error) {
	var config WebhookConfig
	if err := decodeNotificationConfig(raw, &config); err != nil {
		return nil, err
	}
	if err := s.cryptField(&config.URL, "webhook", "url", true); err != nil {
		return nil, err
	}
	if err := s.cryptField(&config.Secret, "webhook", "secret", true); err != nil {
		return nil, err
	}
	return &config, nil
}

func (s *service) GetWebhookConfig(ctx context.Context) (*WebhookConfig, error) {
	row, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	return s.readWebhook(row.WebhookConfig)
}

func (s *service) readDingTalk(raw string) (*DingTalkConfig, error) {
	var config DingTalkConfig
	if err := decodeNotificationConfig(raw, &config); err != nil {
		return nil, err
	}
	if err := s.cryptField(&config.WebhookURL, "dingtalk", "webhook_url", true); err != nil {
		return nil, err
	}
	if err := s.cryptField(&config.Secret, "dingtalk", "secret", true); err != nil {
		return nil, err
	}
	return &config, nil
}

func (s *service) GetDingTalkConfig(ctx context.Context) (*DingTalkConfig, error) {
	row, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	return s.readDingTalk(row.DingTalkConfig)
}

func (s *service) readWeCom(raw string) (*WeComConfig, error) {
	var config WeComConfig
	if err := decodeNotificationConfig(raw, &config); err != nil {
		return nil, err
	}
	if err := s.cryptField(&config.WebhookURL, "wecom", "webhook_url", true); err != nil {
		return nil, err
	}
	return &config, nil
}

func (s *service) GetWeComConfig(ctx context.Context) (*WeComConfig, error) {
	row, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	return s.readWeCom(row.WeComConfig)
}

func (s *service) GetAllConfig(ctx context.Context) (*AllNotificationConfig, error) {
	row, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	result := &AllNotificationConfig{}
	result.SMTP, err = s.readSMTP(row.SMTPConfig)
	if err != nil {
		return nil, err
	}
	result.Webhook, err = s.readWebhook(row.WebhookConfig)
	if err != nil {
		return nil, err
	}
	result.DingTalk, err = s.readDingTalk(row.DingTalkConfig)
	if err != nil {
		return nil, err
	}
	result.WeCom, err = s.readWeCom(row.WeComConfig)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *service) SaveAllConfig(ctx context.Context, input *protocol.NotificationConfigUpdate) error {
	if input == nil {
		return ErrInvalidConfig
	}
	if input.SMTP == nil && input.Webhook == nil && input.DingTalk == nil && input.WeCom == nil {
		return nil
	}
	return s.repo.Update(ctx, func(row *NotificationConfig) error {
		if input.SMTP != nil {
			current, err := s.readSMTP(row.SMTPConfig)
			if err != nil {
				return err
			}
			config := mergeSMTPConfig(*current, input.SMTP)
			if err := s.validateSMTPConfig(&config); err != nil {
				return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
			}
			if config != *current {
				if err := s.cryptField(&config.Password, "smtp", "password", false); err != nil {
					return err
				}
				data, err := json.Marshal(config)
				if err != nil {
					return err
				}
				row.SMTPConfig = string(data)
			}
		}
		if input.Webhook != nil {
			current, err := s.readWebhook(row.WebhookConfig)
			if err != nil {
				return err
			}
			config := mergeWebhookConfig(*current, input.Webhook)
			if err := s.validateWebhookConfig(&config); err != nil {
				return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
			}
			if config != *current {
				if err := s.cryptField(&config.URL, "webhook", "url", false); err != nil {
					return err
				}
				if err := s.cryptField(&config.Secret, "webhook", "secret", false); err != nil {
					return err
				}
				data, err := json.Marshal(config)
				if err != nil {
					return err
				}
				row.WebhookConfig = string(data)
			}
		}
		if input.DingTalk != nil {
			current, err := s.readDingTalk(row.DingTalkConfig)
			if err != nil {
				return err
			}
			config := mergeDingTalkConfig(*current, input.DingTalk)
			if err := s.validateDingTalkConfig(&config); err != nil {
				return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
			}
			if config != *current {
				if err := s.cryptField(&config.WebhookURL, "dingtalk", "webhook_url", false); err != nil {
					return err
				}
				if err := s.cryptField(&config.Secret, "dingtalk", "secret", false); err != nil {
					return err
				}
				data, err := json.Marshal(config)
				if err != nil {
					return err
				}
				row.DingTalkConfig = string(data)
			}
		}
		if input.WeCom != nil {
			current, err := s.readWeCom(row.WeComConfig)
			if err != nil {
				return err
			}
			config := mergeWeComConfig(*current, input.WeCom)
			if err := s.validateWeComConfig(&config); err != nil {
				return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
			}
			if config != *current {
				if err := s.cryptField(&config.WebhookURL, "wecom", "webhook_url", false); err != nil {
					return err
				}
				data, err := json.Marshal(config)
				if err != nil {
					return err
				}
				row.WeComConfig = string(data)
			}
		}
		return nil
	})
}

func (s *service) TestSMTPConnection(ctx context.Context, input *protocol.SMTPConfigUpdate) error {
	if input == nil {
		return ErrInvalidConfig
	}
	current, err := s.GetSMTPConfig(ctx)
	if err != nil {
		return err
	}
	config := mergeSMTPConfig(*current, input)
	if !config.Enabled {
		return fmt.Errorf("%w: SMTP is disabled", ErrInvalidConfig)
	}
	if err := s.validateSMTPConfig(&config); err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
	}
	client, err := mailclient.New(mailclient.Config{Host: config.Host, Port: config.Port, Username: config.Username, Password: config.Password, UseTLS: config.UseTLS})
	if err != nil {
		return notificationTestError(err)
	}
	if err := client.DialWithContext(ctx); err != nil {
		return notificationTestError(err)
	}
	return notificationTestError(client.Close())
}

func (s *service) validateSMTPConfig(config *SMTPConfig) error {
	if config == nil {
		return ErrInvalidConfig
	}
	if utf8.RuneCountInString(config.Host) > 4096 {
		return errors.New("smtp.host is too long")
	}
	if utf8.RuneCountInString(config.Username) > 4096 {
		return errors.New("smtp.username is too long")
	}
	if utf8.RuneCountInString(config.Password) > 4096 {
		return errors.New("smtp.password is too long")
	}
	if utf8.RuneCountInString(config.FromEmail) > 4096 {
		return errors.New("smtp.from_email is too long")
	}
	if utf8.RuneCountInString(config.FromName) > 4096 {
		return errors.New("smtp.from_name is too long")
	}

	if !config.Enabled {
		return nil
	}

	if config.Host == "" {
		return errors.New("SMTP host is required")
	}
	if config.Port < 1 || config.Port > 65535 {
		return errors.New("SMTP port must be between 1 and 65535")
	}
	if config.Username == "" {
		return errors.New("SMTP username is required")
	}
	if config.FromEmail == "" {
		return errors.New("from email is required")
	}
	if config.FromName == "" {
		return errors.New("from name is required")
	}

	// 验证邮箱格式
	if !strings.Contains(config.FromEmail, "@") {
		return errors.New("invalid email format")
	}

	return nil
}

func (s *service) TestWebhookConnection(ctx context.Context, input *protocol.WebhookConfigUpdate) error {
	if input == nil {
		return ErrInvalidConfig
	}
	current, err := s.GetWebhookConfig(ctx)
	if err != nil {
		return err
	}
	config := mergeWebhookConfig(*current, input)
	if !config.Enabled {
		return fmt.Errorf("%w: Webhook is disabled", ErrInvalidConfig)
	}
	if err := s.validateWebhookConfig(&config); err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
	}
	sender, err := notification.NewWebhookService(&notification.WebhookConfig{URL: config.URL, Secret: config.Secret, Method: config.Method})
	if err != nil {
		return notificationTestError(err)
	}
	return notificationTestError(sender.SendNotification(ctx, "test", map[string]interface{}{"message": "EasySSH notification test", "source": "EasySSH"}))
}

func (s *service) validateWebhookConfig(config *WebhookConfig) error {
	if config == nil {
		return ErrInvalidConfig
	}
	if utf8.RuneCountInString(config.URL) > 8192 {
		return errors.New("webhook.url is too long")
	}
	if utf8.RuneCountInString(config.Secret) > 4096 {
		return errors.New("webhook.secret is too long")
	}
	if utf8.RuneCountInString(config.Method) > 4096 {
		return errors.New("webhook.method is too long")
	}

	if !config.Enabled {
		return nil
	}

	if config.URL == "" {
		return errors.New("webhook URL is required")
	}

	// 验证URL格式
	if err := validateNotificationURL(config.URL); err != nil {
		return fmt.Errorf("invalid webhook URL: %w", err)
	}

	// 验证HTTP方法
	if config.Method != "GET" && config.Method != "POST" {
		return errors.New("webhook method must be GET or POST")
	}

	return nil
}

func (s *service) TestDingTalkConnection(ctx context.Context, input *protocol.DingTalkConfigUpdate) error {
	if input == nil {
		return ErrInvalidConfig
	}
	current, err := s.GetDingTalkConfig(ctx)
	if err != nil {
		return err
	}
	config := mergeDingTalkConfig(*current, input)
	if !config.Enabled {
		return fmt.Errorf("%w: DingTalk is disabled", ErrInvalidConfig)
	}
	if err := s.validateDingTalkConfig(&config); err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
	}
	sender, err := notification.NewDingTalkService(&notification.DingTalkConfig{WebhookURL: config.WebhookURL, Secret: config.Secret})
	if err != nil {
		return notificationTestError(err)
	}
	return notificationTestError(sender.SendTextMessage(ctx, "EasySSH DingTalk 通知测试"))
}

func (s *service) validateDingTalkConfig(config *DingTalkConfig) error {
	if config == nil {
		return ErrInvalidConfig
	}
	if utf8.RuneCountInString(config.WebhookURL) > 8192 {
		return errors.New("dingtalk.webhook_url is too long")
	}
	if utf8.RuneCountInString(config.Secret) > 4096 {
		return errors.New("dingtalk.secret is too long")
	}

	if !config.Enabled {
		return nil
	}

	if config.WebhookURL == "" {
		return errors.New("dingtalk webhook URL is required")
	}

	// 验证URL格式
	if err := validateNotificationURL(config.WebhookURL); err != nil {
		return fmt.Errorf("invalid dingtalk webhook URL: %w", err)
	}

	return nil
}

func (s *service) TestWeComConnection(ctx context.Context, input *protocol.WeComConfigUpdate) error {
	if input == nil {
		return ErrInvalidConfig
	}
	current, err := s.GetWeComConfig(ctx)
	if err != nil {
		return err
	}
	config := mergeWeComConfig(*current, input)
	if !config.Enabled {
		return fmt.Errorf("%w: WeCom is disabled", ErrInvalidConfig)
	}
	if err := s.validateWeComConfig(&config); err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidConfig, err)
	}
	sender, err := notification.NewWeComService(&notification.WeComConfig{WebhookURL: config.WebhookURL})
	if err != nil {
		return notificationTestError(err)
	}
	return notificationTestError(sender.SendTextMessage(ctx, "EasySSH WeCom 通知测试"))
}

func (s *service) validateWeComConfig(config *WeComConfig) error {
	if config == nil {
		return ErrInvalidConfig
	}
	if utf8.RuneCountInString(config.WebhookURL) > 8192 {
		return errors.New("wecom.webhook_url is too long")
	}

	if !config.Enabled {
		return nil
	}

	if config.WebhookURL == "" {
		return errors.New("wecom webhook URL is required")
	}

	// 验证URL格式
	if err := validateNotificationURL(config.WebhookURL); err != nil {
		return fmt.Errorf("invalid wecom webhook URL: %w", err)
	}

	return nil
}

func validateNotificationURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("an absolute HTTP(S) URL without userinfo or fragment is required")
	}
	return nil
}

// Transport and provider errors can echo saved passwords, tokens or request URLs.
// Return a stable failure without exposing those values through the test endpoint.
func notificationTestError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("%w: request canceled", ErrConnectionTest)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%w: request timed out", ErrConnectionTest)
	}
	return ErrConnectionTest
}
