package notification

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"time"

	"github.com/easyssh/server/internal/pkg/mailclient"
	mail "github.com/wneessen/go-mail"
)

// smtpEmailService SMTP 邮件服务实现
type smtpEmailService struct {
	config    *EmailConfig
	templates map[EmailTemplate]*template.Template
	client    *mail.Client
}

// NewEmailService 创建邮件服务
func NewEmailService(config *EmailConfig) (EmailService, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("invalid email config: %w", err)
	}

	client, err := mailclient.New(mailclient.Config{
		Host:     config.SMTPHost,
		Port:     config.SMTPPort,
		Username: config.SMTPUsername,
		Password: config.SMTPPassword,
		UseTLS:   config.UseTLS,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create SMTP client: %w", err)
	}

	service := &smtpEmailService{
		config:    config,
		templates: make(map[EmailTemplate]*template.Template),
		client:    client,
	}

	// 初始化邮件模板
	if err := service.initTemplates(); err != nil {
		return nil, fmt.Errorf("failed to init templates: %w", err)
	}

	return service, nil
}

// initTemplates 初始化邮件模板
func (s *smtpEmailService) initTemplates() error {
	// 登录通知模板
	s.templates[TemplateLogin] = template.Must(template.New("login").Parse(loginTemplate))

	// 告警通知模板
	s.templates[TemplateAlert] = template.Must(template.New("alert").Parse(alertTemplate))

	// 欢迎邮件模板
	s.templates[TemplateWelcome] = template.Must(template.New("welcome").Parse(welcomeTemplate))

	// 2FA 启用通知模板
	s.templates[Template2FAEnabled] = template.Must(template.New("2fa_enabled").Parse(twoFAEnabledTemplate))

	// 密码修改通知模板
	s.templates[TemplatePasswordChange] = template.Must(template.New("password_changed").Parse(passwordChangedTemplate))

	// 验证码邮件模板
	s.templates[TemplateVerificationCode] = template.Must(template.New("verification_code").Parse(verificationCodeTemplate))

	// 密码重置验证码邮件模板
	s.templates[TemplatePasswordReset] = template.Must(template.New("password_reset").Parse(passwordResetTemplate))

	// 新设备登录告警模板
	s.templates[TemplateNewDevice] = template.Must(template.New("new_device").Parse(newDeviceAlertTemplate))

	// 新地点登录告警模板
	s.templates[TemplateNewLocation] = template.Must(template.New("new_location").Parse(newLocationAlertTemplate))

	// 可疑登录告警模板
	s.templates[TemplateSuspiciousLogin] = template.Must(template.New("suspicious_login").Parse(suspiciousLoginAlertTemplate))

	// 账户锁定告警模板
	s.templates[TemplateAccountLocked] = template.Must(template.New("account_locked").Parse(accountLockedAlertTemplate))

	return nil
}

// SendLoginNotification 发送登录通知邮件
func (s *smtpEmailService) SendLoginNotification(ctx context.Context, email, username, ipAddress, location, deviceInfo string, loginTime time.Time) error {
	data := map[string]interface{}{
		"Username":   username,
		"IPAddress":  ipAddress,
		"Location":   location,
		"DeviceInfo": deviceInfo,
		"LoginTime":  loginTime.Format("2006-01-02 15:04:05"),
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  "🔐 新设备登录通知 - EasySSH",
		Template: TemplateLogin,
		Data:     data,
	})
}

// SendAlertNotification 发送告警通知邮件
func (s *smtpEmailService) SendAlertNotification(ctx context.Context, email, username, alertType, alertMessage string, alertTime time.Time) error {
	data := map[string]interface{}{
		"Username":     username,
		"AlertType":    alertType,
		"AlertMessage": alertMessage,
		"AlertTime":    alertTime.Format("2006-01-02 15:04:05"),
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  "⚠️ 系统告警通知 - EasySSH",
		Template: TemplateAlert,
		Data:     data,
	})
}

// SendWelcomeEmail 发送欢迎邮件
func (s *smtpEmailService) SendWelcomeEmail(ctx context.Context, email, username string) error {
	data := map[string]interface{}{
		"Username": username,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  "🎉 欢迎使用 EasySSH",
		Template: TemplateWelcome,
		Data:     data,
	})
}

// Send2FAEnabledNotification 发送 2FA 启用通知
func (s *smtpEmailService) Send2FAEnabledNotification(ctx context.Context, email, username string) error {
	data := map[string]interface{}{
		"Username": username,
		"Time":     time.Now().Format("2006-01-02 15:04:05"),
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  "🔒 双因子认证已启用 - EasySSH",
		Template: Template2FAEnabled,
		Data:     data,
	})
}

// SendPasswordChangedNotification 发送密码修改通知
func (s *smtpEmailService) SendPasswordChangedNotification(ctx context.Context, email, username string, changeTime time.Time) error {
	data := map[string]interface{}{
		"Username":   username,
		"ChangeTime": changeTime.Format("2006-01-02 15:04:05"),
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  "🔑 密码已修改 - EasySSH",
		Template: TemplatePasswordChange,
		Data:     data,
	})
}

// SendVerificationCode 发送验证码邮件（注册用）
func (s *smtpEmailService) SendVerificationCode(ctx context.Context, email, code string) error {
	// 使用系统配置中的名称，如果未设置则使用默认值
	systemName := s.config.SystemName
	if systemName == "" {
		systemName = "EasySSH"
	}

	// 使用配置中的年份，如果未设置则使用当前年份
	currentYear := s.config.CurrentYear
	if currentYear == 0 {
		currentYear = time.Now().Year()
	}

	data := map[string]interface{}{
		"Code":        code,
		"SystemName":  systemName,
		"CurrentYear": currentYear,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  fmt.Sprintf("📧 邮箱验证码 - %s", systemName),
		Template: TemplateVerificationCode,
		Data:     data,
	})
}

// SendPasswordResetCode 发送密码重置验证码邮件
func (s *smtpEmailService) SendPasswordResetCode(ctx context.Context, email, code string) error {
	// 使用系统配置中的名称，如果未设置则使用默认值
	systemName := s.config.SystemName
	if systemName == "" {
		systemName = "EasySSH"
	}

	// 使用配置中的年份，如果未设置则使用当前年份
	currentYear := s.config.CurrentYear
	if currentYear == 0 {
		currentYear = time.Now().Year()
	}

	data := map[string]interface{}{
		"Code":        code,
		"SystemName":  systemName,
		"CurrentYear": currentYear,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  fmt.Sprintf("🔑 密码重置验证码 - %s", systemName),
		Template: TemplatePasswordReset,
		Data:     data,
	})
}

// sendEmail 发送邮件（内部方法）
func (s *smtpEmailService) sendEmail(ctx context.Context, emailData *EmailData) error {
	// 获取模板
	tmpl, ok := s.templates[emailData.Template]
	if !ok {
		return fmt.Errorf("template %s not found", emailData.Template)
	}

	// 渲染模板
	var body bytes.Buffer
	if err := tmpl.Execute(&body, emailData.Data); err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	message := mail.NewMsg()
	if err := message.FromFormat(s.config.FromName, s.config.FromEmail); err != nil {
		return fmt.Errorf("invalid sender address: %w", err)
	}
	if err := message.To(emailData.To); err != nil {
		return fmt.Errorf("invalid recipient address: %w", err)
	}
	message.Subject(emailData.Subject)
	message.SetBodyString(mail.TypeTextHTML, body.String())

	if err := s.client.DialAndSendWithContext(ctx, message); err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}
	return nil
}

// SendNewDeviceAlert 发送新设备登录告警
func (s *smtpEmailService) SendNewDeviceAlert(ctx context.Context, email, username, deviceName, ip, location string, loginTime time.Time) error {
	systemName := s.config.SystemName
	if systemName == "" {
		systemName = "EasySSH"
	}

	data := map[string]interface{}{
		"Username":   username,
		"DeviceName": deviceName,
		"IPAddress":  ip,
		"Location":   location,
		"LoginTime":  loginTime.Format("2006-01-02 15:04:05"),
		"SystemName": systemName,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  fmt.Sprintf("🆕 新设备登录告警 - %s", systemName),
		Template: TemplateNewDevice,
		Data:     data,
	})
}

// SendNewLocationAlert 发送新地理位置登录告警
func (s *smtpEmailService) SendNewLocationAlert(ctx context.Context, email, username, location, ip string, loginTime time.Time) error {
	systemName := s.config.SystemName
	if systemName == "" {
		systemName = "EasySSH"
	}

	data := map[string]interface{}{
		"Username":   username,
		"Location":   location,
		"IPAddress":  ip,
		"LoginTime":  loginTime.Format("2006-01-02 15:04:05"),
		"SystemName": systemName,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  fmt.Sprintf("📍 新地点登录告警 - %s", systemName),
		Template: TemplateNewLocation,
		Data:     data,
	})
}

// SendSuspiciousLoginAlert 发送可疑登录告警
func (s *smtpEmailService) SendSuspiciousLoginAlert(ctx context.Context, email, username, reason, ip, location string, loginTime time.Time) error {
	systemName := s.config.SystemName
	if systemName == "" {
		systemName = "EasySSH"
	}

	data := map[string]interface{}{
		"Username":   username,
		"Reason":     reason,
		"IPAddress":  ip,
		"Location":   location,
		"LoginTime":  loginTime.Format("2006-01-02 15:04:05"),
		"SystemName": systemName,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  fmt.Sprintf("⚠️ 可疑登录告警 - %s", systemName),
		Template: TemplateSuspiciousLogin,
		Data:     data,
	})
}

// SendAccountLockedAlert 发送账户锁定告警
func (s *smtpEmailService) SendAccountLockedAlert(ctx context.Context, email, username, reason string, unlockTime time.Time) error {
	systemName := s.config.SystemName
	if systemName == "" {
		systemName = "EasySSH"
	}

	data := map[string]interface{}{
		"Username":   username,
		"Reason":     reason,
		"UnlockTime": unlockTime.Format("2006-01-02 15:04:05"),
		"SystemName": systemName,
	}

	return s.sendEmail(ctx, &EmailData{
		To:       email,
		Subject:  fmt.Sprintf("🔒 账户已锁定 - %s", systemName),
		Template: TemplateAccountLocked,
		Data:     data,
	})
}
