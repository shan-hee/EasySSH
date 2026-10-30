package notificationconfig

import "github.com/easyssh/shared/protocol"

func mergeSMTPConfig(current SMTPConfig, input *protocol.SMTPConfigUpdate) SMTPConfig {
	if input == nil {
		return current
	}
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}
	if input.Host != nil {
		current.Host = *input.Host
	}
	if input.Port != nil {
		current.Port = *input.Port
	}
	if input.Username != nil {
		current.Username = *input.Username
	}
	if input.Password != nil {
		current.Password = *input.Password
	}
	if input.FromEmail != nil {
		current.FromEmail = *input.FromEmail
	}
	if input.FromName != nil {
		current.FromName = *input.FromName
	}
	if input.UseTLS != nil {
		current.UseTLS = *input.UseTLS
	}
	return current
}

func (config SMTPConfig) Public() protocol.SMTPConfigView {
	return protocol.SMTPConfigView{
		Enabled:     config.Enabled,
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		HasPassword: config.Password != "",
		FromEmail:   config.FromEmail,
		FromName:    config.FromName,
		UseTLS:      config.UseTLS,
	}
}

func mergeWebhookConfig(current WebhookConfig, input *protocol.WebhookConfigUpdate) WebhookConfig {
	if input == nil {
		return current
	}
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}
	if input.URL != nil {
		current.URL = *input.URL
	}
	if input.Secret != nil {
		current.Secret = *input.Secret
	}
	if input.Method != nil {
		current.Method = *input.Method
	}
	return current
}

func (config WebhookConfig) Public() protocol.WebhookConfigView {
	return protocol.WebhookConfigView{
		Enabled:   config.Enabled,
		HasURL:    config.URL != "",
		HasSecret: config.Secret != "",
		Method:    config.Method,
	}
}

func mergeDingTalkConfig(current DingTalkConfig, input *protocol.DingTalkConfigUpdate) DingTalkConfig {
	if input == nil {
		return current
	}
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}
	if input.WebhookURL != nil {
		current.WebhookURL = *input.WebhookURL
	}
	if input.Secret != nil {
		current.Secret = *input.Secret
	}
	return current
}

func (config DingTalkConfig) Public() protocol.DingTalkConfigView {
	return protocol.DingTalkConfigView{
		Enabled:       config.Enabled,
		HasWebhookURL: config.WebhookURL != "",
		HasSecret:     config.Secret != "",
	}
}

func mergeWeComConfig(current WeComConfig, input *protocol.WeComConfigUpdate) WeComConfig {
	if input == nil {
		return current
	}
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}
	if input.WebhookURL != nil {
		current.WebhookURL = *input.WebhookURL
	}
	return current
}

func (config WeComConfig) Public() protocol.WeComConfigView {
	return protocol.WeComConfigView{
		Enabled:       config.Enabled,
		HasWebhookURL: config.WebhookURL != "",
	}
}

func (config AllNotificationConfig) Public() protocol.NotificationConfigView {
	return protocol.NotificationConfigView{SMTP: config.SMTP.Public(), Webhook: config.Webhook.Public(), DingTalk: config.DingTalk.Public(), WeCom: config.WeCom.Public()}
}
