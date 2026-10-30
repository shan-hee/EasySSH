package auth

import (
	"context"
	"time"
)

type EmailService interface {
	// 登录告警相关方法
	SendNewDeviceAlert(ctx context.Context, email, username, deviceName, ip, location string, loginTime time.Time) error
	SendNewLocationAlert(ctx context.Context, email, username, location, ip string, loginTime time.Time) error
}
